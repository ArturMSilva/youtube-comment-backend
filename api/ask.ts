import type { VercelRequest, VercelResponse } from '@vercel/node'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import type { AskRequest } from '../types'

function applyCORS(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers['origin'] as string) ?? ''

  // Permite apenas extensões Chrome e localhost
  if (origin.startsWith('chrome-extension://') || origin === 'http://localhost') {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return true // preflight tratado, não continuar
  }
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res)) return

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
  try {
    relevantes = await selectRelevantComments(method, sanitized, body.comentarios, 30)
  } catch (error) {
    // Caminho semântico: falha do Gemini vira erro explícito (sem fallback para keyword)
    return res.status(502).json({ error: 'Falha ao gerar embeddings (busca semântica)' })
  }

  const resultado = await askGroq(sanitized, relevantes)

  return res.status(200).json(resultado)
}
