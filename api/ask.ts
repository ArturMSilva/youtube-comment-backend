import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCORS } from '../lib/cors'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import { getDb } from '../lib/db'
import { salvarInteracao } from '../lib/persistence'
import type { AskRequest } from '../types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res, 'POST, OPTIONS')) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const body = req.body as AskRequest

  if (!body?.pergunta?.trim()) {
    return res.status(400).json({ error: 'pergunta é obrigatória' })
  }
  if (!Array.isArray(body?.comentarios) || body.comentarios.length === 0) {
    return res.status(400).json({ error: 'comentarios não pode estar vazio' })
  }

  const sanitized = body.pergunta.slice(0, 500) // previne prompt injection por tamanho
  const method = body.method === 'semantic' ? 'semantic' : 'keyword' // default: keyword

  let relevantes
  let latenciaFiltroMs: number
  try {
    const inicio = Date.now()
    relevantes = await selectRelevantComments(method, sanitized, body.comentarios, 30)
    latenciaFiltroMs = Date.now() - inicio
  } catch (error) {
    // Caminho semântico: falha do Gemini vira erro explícito (sem fallback para keyword)
    return res.status(502).json({ error: 'Falha ao gerar embeddings (busca semântica)' })
  }

  const resultado = await askGroq(sanitized, relevantes)

  // Persistência é best-effort: nunca derruba a resposta ao usuário.
  try {
    await salvarInteracao(getDb(), {
      videoId: body.videoId ?? null,
      pergunta: sanitized,
      resposta: resultado.resposta,
      metodo: method,
      modeloLlm: resultado.modelo,
      totalComentariosRecebidos: body.comentarios.length,
      latenciaFiltroMs,
      comentariosFiltrados: relevantes,
      indicesFonte: resultado.indicesFonte,
    })
  } catch (error) {
    console.error('Falha ao persistir interação:', error)
  }

  return res.status(200).json({
    resposta: resultado.resposta,
    comentarios_fonte: resultado.comentarios_fonte,
  })
}
