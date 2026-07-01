import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filterRelevantComments, semanticFilterComments } from '../lib/retrieval'
import * as embeddings from '../lib/embeddings'
import type { Comment } from '../types'

// Mantém as funções puras reais (cosineSimilarity, chunk) e só substitui as
// chamadas de rede. Assim a ordenação é determinística pelos vetores mockados.
vi.mock('../lib/embeddings', async (importActual) => {
  const actual = await importActual<typeof import('../lib/embeddings')>()
  return {
    ...actual,
    embedQuery: vi.fn(),
    embedDocuments: vi.fn(),
  }
})

const mockEmbedQuery = vi.mocked(embeddings.embedQuery)
const mockEmbedDocuments = vi.mocked(embeddings.embedDocuments)

const mockComments: Comment[] = [
  { id: '1', text: 'A bateria dura o dia todo muito boa', likeCount: 100 },
  { id: '2', text: 'Tela muito bonita e brilhante', likeCount: 50 },
  { id: '3', text: 'Bateria melhorou bastante nessa versão', likeCount: 80 },
  { id: '4', text: 'Câmera excelente tira fotos lindas', likeCount: 200 },
]

describe('filterRelevantComments', () => {
  it('retorna apenas comentários com keywords da pergunta', () => {
    const result = filterRelevantComments('como está a bateria', mockComments, 10)
    const ids = result.map(c => c.id)
    expect(ids).toContain('1')
    expect(ids).toContain('3')
    expect(ids).not.toContain('2')
    expect(ids).not.toContain('4')
  })

  it('faz fallback para top por likes quando nenhum match', () => {
    const result = filterRelevantComments('processador velocidade', mockComments, 2)
    expect(result).toHaveLength(2)
    expect(result[0].likeCount).toBe(200)
    expect(result[1].likeCount).toBe(100)
  })

  it('respeita o limite topN', () => {
    const result = filterRelevantComments('bateria tela câmera', mockComments, 2)
    expect(result).toHaveLength(2)
  })

  it('retorna array vazio quando comentarios está vazio', () => {
    const result = filterRelevantComments('bateria', [], 10)
    expect(result).toHaveLength(0)
  })
})

describe('semanticFilterComments', () => {
  beforeEach(() => {
    mockEmbedQuery.mockReset()
    mockEmbedDocuments.mockReset()
  })

  const comments: Comment[] = [
    { id: 'a', text: 'igual à query', likeCount: 10 },
    { id: 'b', text: 'ortogonal', likeCount: 10 },
    { id: 'c', text: 'parecido', likeCount: 10 },
  ]

  it('ordena por similaridade de cosseno (maior primeiro)', async () => {
    mockEmbedQuery.mockResolvedValue([1, 0])
    mockEmbedDocuments.mockResolvedValue([
      [1, 0], // a → sim 1
      [0, 1], // b → sim 0
      [0.9, 0.1], // c → sim ~0.99
    ])

    const result = await semanticFilterComments('q', comments, 10)
    expect(result.map(c => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('respeita topN', async () => {
    mockEmbedQuery.mockResolvedValue([1, 0])
    mockEmbedDocuments.mockResolvedValue([[1, 0], [0, 1], [0.9, 0.1]])
    const result = await semanticFilterComments('q', comments, 2)
    expect(result).toHaveLength(2)
  })

  it('retorna vazio quando não há comentários (sem chamar embeddings)', async () => {
    const result = await semanticFilterComments('q', [], 10)
    expect(result).toEqual([])
    expect(mockEmbedQuery).not.toHaveBeenCalled()
  })

  it('propaga o erro quando o Gemini falha (erro explícito, sem fallback)', async () => {
    mockEmbedQuery.mockRejectedValue(new Error('429'))
    mockEmbedDocuments.mockResolvedValue([[1, 0], [0, 1], [0.9, 0.1]])
    await expect(semanticFilterComments('q', comments, 10)).rejects.toThrow('429')
  })
})
