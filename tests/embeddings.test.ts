import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbedContent = vi.fn()
const mockBatchEmbedContents = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      embedContent: mockEmbedContent,
      batchEmbedContents: mockBatchEmbedContents,
    }),
  })),
  TaskType: {
    RETRIEVAL_QUERY: 'RETRIEVAL_QUERY',
    RETRIEVAL_DOCUMENT: 'RETRIEVAL_DOCUMENT',
  },
}))

import { cosineSimilarity, chunk, embedQuery, embedDocuments } from '../lib/embeddings'

describe('cosineSimilarity', () => {
  it('retorna 1 para vetores idênticos', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1)
  })

  it('retorna 0 para vetores ortogonais', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('retorna -1 para vetores opostos', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('retorna 0 quando algum vetor é nulo (evita divisão por zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('chunk', () => {
  it('fatia em lotes do tamanho pedido', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i)
    const lotes = chunk(arr, 100)
    expect(lotes).toHaveLength(3)
    expect(lotes[0]).toHaveLength(100)
    expect(lotes[1]).toHaveLength(100)
    expect(lotes[2]).toHaveLength(50)
  })

  it('retorna lista vazia para array vazio', () => {
    expect(chunk([], 100)).toEqual([])
  })
})

describe('embedQuery', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset()
  })

  it('retorna o vetor de embedding da pergunta', async () => {
    mockEmbedContent.mockResolvedValue({ embedding: { values: [0.1, 0.2, 0.3] } })
    const vec = await embedQuery('como está a bateria')
    expect(vec).toEqual([0.1, 0.2, 0.3])
    expect(mockEmbedContent).toHaveBeenCalledTimes(1)
  })

  it('propaga o erro quando o Gemini falha (sem fallback)', async () => {
    mockEmbedContent.mockRejectedValue(new Error('429 rate limit'))
    await expect(embedQuery('x')).rejects.toThrow('429 rate limit')
  })
})

describe('embedDocuments', () => {
  beforeEach(() => {
    mockBatchEmbedContents.mockReset()
  })

  it('retorna lista vazia para entrada vazia sem chamar o Gemini', async () => {
    const vecs = await embedDocuments([])
    expect(vecs).toEqual([])
    expect(mockBatchEmbedContents).not.toHaveBeenCalled()
  })

  it('fatia em lotes de 100 e achata os resultados na ordem', async () => {
    const textos = Array.from({ length: 150 }, (_, i) => `c${i}`)
    mockBatchEmbedContents.mockImplementation(async ({ requests }) => ({
      embeddings: requests.map(() => ({ values: [1, 0] })),
    }))

    const vecs = await embedDocuments(textos)

    expect(mockBatchEmbedContents).toHaveBeenCalledTimes(2)
    expect(mockBatchEmbedContents.mock.calls[0][0].requests).toHaveLength(100)
    expect(mockBatchEmbedContents.mock.calls[1][0].requests).toHaveLength(50)
    expect(vecs).toHaveLength(150)
    expect(vecs[0]).toEqual([1, 0])
  })

  it('propaga o erro quando o Gemini falha (sem fallback)', async () => {
    mockBatchEmbedContents.mockRejectedValue(new Error('network'))
    await expect(embedDocuments(['a', 'b'])).rejects.toThrow('network')
  })
})
