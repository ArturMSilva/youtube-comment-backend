import type { Comment } from '../types'
import { embedQuery, embedDocuments, cosineSimilarity } from './embeddings'

export function filterRelevantComments(
  pergunta: string,
  comentarios: Comment[],
  topN: number = 30
): Comment[] {
  if (comentarios.length === 0) return []

  const keywords = pergunta
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3)

  if (keywords.length === 0) {
    return [...comentarios]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, topN)
  }

  const scored = comentarios.map(comment => {
    const text = comment.text.toLowerCase()
    const score = keywords.reduce((sum, kw) => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const matches = (text.match(new RegExp(escaped, 'g')) || []).length
      return sum + matches
    }, 0)
    return { comment, score }
  })

  const withMatches = scored.filter(s => s.score > 0)

  if (withMatches.length === 0) {
    return [...comentarios]
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, topN)
  }

  return withMatches
    .sort((a, b) => b.score - a.score || b.comment.likeCount - a.comment.likeCount)
    .slice(0, topN)
    .map(s => s.comment)
}

export async function semanticFilterComments(
  pergunta: string,
  comentarios: Comment[],
  topN: number = 30
): Promise<Comment[]> {
  if (comentarios.length === 0) return []

  const [queryVec, docVecs] = await Promise.all([
    embedQuery(pergunta),
    embedDocuments(comentarios.map(c => c.text)),
  ])

  const scored = comentarios.map((comment, i) => ({
    comment,
    score: cosineSimilarity(queryVec, docVecs[i]),
  }))

  return scored
    .sort((a, b) => b.score - a.score || b.comment.likeCount - a.comment.likeCount)
    .slice(0, topN)
    .map(s => s.comment)
}

export type RetrievalMethod = 'keyword' | 'semantic'

export async function selectRelevantComments(
  method: RetrievalMethod,
  pergunta: string,
  comentarios: Comment[],
  topN: number = 30
): Promise<Comment[]> {
  if (method === 'semantic') {
    return semanticFilterComments(pergunta, comentarios, topN)
  }
  return filterRelevantComments(pergunta, comentarios, topN)
}
