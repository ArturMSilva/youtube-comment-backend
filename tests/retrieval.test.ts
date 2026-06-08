import { describe, it, expect } from 'vitest'
import { filterRelevantComments } from '../lib/retrieval'
import type { Comment } from '../types'

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
