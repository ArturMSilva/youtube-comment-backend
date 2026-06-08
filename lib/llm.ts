import Groq from 'groq-sdk'
import type { Comment, AskResponse } from '../types'

const PRIMARY_MODEL = 'llama-3.3-70b-versatile'
const FALLBACK_MODEL = 'mixtral-8x7b-32768'

function buildPrompt(pergunta: string, comentarios: Comment[]): string {
  const lista = comentarios
    .map((c, i) => `[${i + 1}] "${c.text}" (${c.likeCount} likes)`)
    .join('\n')

  return `Você é um assistente que analisa comentários de vídeos do YouTube sobre reviews de produtos.

Comentários dos usuários:
${lista}

Pergunta: ${pergunta}

Responda em português de forma concisa (2-4 frases).
Ao final, indique os números dos comentários que embasaram sua resposta no formato:
FONTES: [1, 3, 7]`
}

export function parseResponse(raw: string, comentarios: Comment[]): AskResponse {
  const fontesMatch = raw.match(/FONTES:\s*\[([^\]]+)\]/)
  const resposta = raw.replace(/FONTES:.*$/s, '').trim()

  let comentarios_fonte: Comment[] = []
  if (fontesMatch) {
    const indices = fontesMatch[1]
      .split(',')
      .map(s => parseInt(s.trim(), 10) - 1) // 1-based → 0-based
      .filter(i => i >= 0 && i < comentarios.length)
    comentarios_fonte = indices.map(i => comentarios[i])
  }

  return { resposta, comentarios_fonte }
}

export async function askGroq(pergunta: string, comentarios: Comment[]): Promise<AskResponse> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const prompt = buildPrompt(pergunta, comentarios)

  const tryModel = async (model: string): Promise<string> => {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  let raw: string
  try {
    raw = await tryModel(PRIMARY_MODEL)
  } catch (error: any) {
    if (error?.status === 429) {
      // Rate limit no modelo primário: tenta o fallback
      raw = await tryModel(FALLBACK_MODEL)
    } else {
      throw error
    }
  }

  return parseResponse(raw, comentarios)
}
