import { describe, it, expect } from 'vitest'
import { cosineSimilarity, chunk } from '../lib/embeddings'

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
