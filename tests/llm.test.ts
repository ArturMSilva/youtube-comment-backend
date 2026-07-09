import { describe, it, expect } from 'vitest'
import { parseResponse } from '../lib/llm'
import type { Comment } from '../types'

const mockComments: Comment[] = [
  { id: '1', text: 'Bateria dura o dia todo', likeCount: 100 },
  { id: '2', text: 'Tela é excelente', likeCount: 50 },
  { id: '3', text: 'Muito rápido no dia a dia', likeCount: 80 },
]

describe('parseResponse', () => {
  it('extrai resposta e fontes corretamente', () => {
    const raw = 'A bateria é excelente e dura o dia todo.\nFONTES: [1, 3]'
    const result = parseResponse(raw, mockComments)
    expect(result.resposta.trim()).toBe('A bateria é excelente e dura o dia todo.')
    expect(result.comentarios_fonte).toHaveLength(2)
    expect(result.comentarios_fonte[0].id).toBe('1')
    expect(result.comentarios_fonte[1].id).toBe('3')
  })

  it('retorna fontes vazias quando FONTES não está na resposta', () => {
    const raw = 'A bateria é boa.'
    const result = parseResponse(raw, mockComments)
    expect(result.resposta.trim()).toBe('A bateria é boa.')
    expect(result.comentarios_fonte).toHaveLength(0)
  })

  it('ignora índices fora do range da lista de comentários', () => {
    const raw = 'Boa.\nFONTES: [1, 99]'
    const result = parseResponse(raw, mockComments)
    expect(result.comentarios_fonte).toHaveLength(1)
    expect(result.comentarios_fonte[0].id).toBe('1')
  })

  it('remove a linha FONTES do texto da resposta exibida', () => {
    const raw = 'Resposta aqui.\nFONTES: [2]'
    const result = parseResponse(raw, mockComments)
    expect(result.resposta).not.toContain('FONTES')
  })

  it('devolve indicesFonte 0-based coerentes com comentarios_fonte', () => {
    const raw = 'Boa.\nFONTES: [1, 3]'
    const result = parseResponse(raw, mockComments)
    expect(result.indicesFonte).toEqual([0, 2])
    expect(result.comentarios_fonte.map(c => c.id)).toEqual(['1', '3'])
  })

  it('devolve indicesFonte vazio quando não há FONTES', () => {
    const result = parseResponse('A bateria é boa.', mockComments)
    expect(result.indicesFonte).toEqual([])
  })

  it('não inclui em indicesFonte índices fora do range', () => {
    const result = parseResponse('Boa.\nFONTES: [1, 99]', mockComments)
    expect(result.indicesFonte).toEqual([0])
  })
})
