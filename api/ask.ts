import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { applyCORS } from '../lib/cors'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import { getDb } from '../lib/db'
import { salvarInteracao } from '../lib/persistence'
import type { AskRequest, Comment, GroqResult } from '../types'

type ResultadoMetodo = {
  metodo: 'keyword' | 'semantic'
  relevantes: Comment[]
  latenciaFiltroMs: number
  resultado: GroqResult
}

async function executarMetodo(
  metodo: 'keyword' | 'semantic',
  pergunta: string,
  comentarios: Comment[]
): Promise<ResultadoMetodo> {
  const inicio = Date.now()
  const relevantes = await selectRelevantComments(metodo, pergunta, comentarios, 30)
  const latenciaFiltroMs = Date.now() - inicio
  const resultado = await askGroq(pergunta, relevantes)
  return { metodo, relevantes, latenciaFiltroMs, resultado }
}

async function persistirInteracao(
  r: ResultadoMetodo,
  ctx: { videoId: string | null; pergunta: string; totalComentariosRecebidos: number; parId: string | null }
): Promise<void> {
  // best-effort: nunca derruba a resposta ao usuário
  try {
    await salvarInteracao(getDb(), {
      videoId: ctx.videoId,
      parId: ctx.parId,
      pergunta: ctx.pergunta,
      resposta: r.resultado.resposta,
      metodo: r.metodo,
      modeloLlm: r.resultado.modelo,
      totalComentariosRecebidos: ctx.totalComentariosRecebidos,
      latenciaFiltroMs: r.latenciaFiltroMs,
      comentariosFiltrados: r.relevantes,
      indicesFonte: r.resultado.indicesFonte,
    })
  } catch (error) {
    console.error('Falha ao persistir interação:', error)
  }
}

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

  const ctxBase = {
    videoId: body.videoId ?? null,
    pergunta: sanitized,
    totalComentariosRecebidos: body.comentarios.length,
  }

  if (body.compare === true) {
    const parId = randomUUID()
    const [kw, sem] = await Promise.allSettled([
      executarMetodo('keyword', sanitized, body.comentarios),
      executarMetodo('semantic', sanitized, body.comentarios),
    ])

    if (kw.status === 'fulfilled') await persistirInteracao(kw.value, { ...ctxBase, parId })
    if (sem.status === 'fulfilled') await persistirInteracao(sem.value, { ...ctxBase, parId })

    if (sem.status === 'fulfilled') {
      return res.status(200).json({
        resposta: sem.value.resultado.resposta,
        comentarios_fonte: sem.value.resultado.comentarios_fonte,
      })
    }
    if (kw.status === 'fulfilled') {
      return res.status(200).json({
        resposta: kw.value.resultado.resposta,
        comentarios_fonte: kw.value.resultado.comentarios_fonte,
        aviso: 'Busca semântica indisponível; resposta gerada por busca por palavra-chave.',
      })
    }
    return res.status(502).json({ error: 'Falha ao gerar resposta (ambos os métodos falharam)' })
  }

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

  await persistirInteracao(
    { metodo: method, relevantes, latenciaFiltroMs, resultado },
    { ...ctxBase, parId: null }
  )

  return res.status(200).json({
    resposta: resultado.resposta,
    comentarios_fonte: resultado.comentarios_fonte,
  })
}
