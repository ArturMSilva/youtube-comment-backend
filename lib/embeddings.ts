import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'

const EMBEDDING_MODEL = 'text-embedding-004'
const BATCH_SIZE = 100

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  return genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

export async function embedQuery(texto: string): Promise<number[]> {
  const model = getModel()
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text: texto }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  })
  return result.embedding.values
}

export async function embedDocuments(textos: string[]): Promise<number[][]> {
  if (textos.length === 0) return []
  const model = getModel()
  const lotes = chunk(textos, BATCH_SIZE)
  const resultados = await Promise.all(
    lotes.map(lote =>
      model.batchEmbedContents({
        requests: lote.map(text => ({
          content: { role: 'user', parts: [{ text }] },
          taskType: TaskType.RETRIEVAL_DOCUMENT,
        })),
      })
    )
  )
  return resultados.flatMap(r => r.embeddings.map(e => e.values))
}
