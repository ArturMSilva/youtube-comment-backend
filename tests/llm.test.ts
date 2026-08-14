import { describe, it, expect, vi, beforeEach } from 'vitest'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

import { parseResponse, askGroq } from '../lib/llm'
import type { Comment } from '../types'

const PRIMARY_MODEL = 'openai/gpt-oss-120b'
const FALLBACK_MODEL = 'openai/gpt-oss-20b'

const mockComments: Comment[] = [
  { id: '1', text: 'Bateria dura o dia todo', likeCount: 100 },
  { id: '2', text: 'Tela é excelente', likeCount: 50 },
  { id: '3', text: 'Muito rápido no dia a dia', likeCount: 80 },
]

function respostaGroq(texto: string) {
  return { choices: [{ message: { content: texto } }] }
}

function erroRateLimit() {
  return Object.assign(new Error('rate limit'), { status: 429 })
}

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

describe('askGroq — seleção entre modelo primário e secundário', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('usa só o modelo primário quando a chamada dá certo', async () => {
    create.mockResolvedValueOnce(respostaGroq('Bateria boa.\nFONTES: [1]'))
    const result = await askGroq('Como é a bateria?', mockComments)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].model).toBe(PRIMARY_MODEL)
    expect(result.modelo).toBe(PRIMARY_MODEL)
  })

  it('cai para o modelo secundário quando o primário retorna 429', async () => {
    create
      .mockRejectedValueOnce(erroRateLimit())
      .mockResolvedValueOnce(respostaGroq('Bateria boa.\nFONTES: [1]'))
    const result = await askGroq('Como é a bateria?', mockComments)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1][0].model).toBe(FALLBACK_MODEL)
    expect(result.modelo).toBe(FALLBACK_MODEL)
  })

  it('manda ao modelo secundário o mesmo prompt e parâmetros do primário', async () => {
    create
      .mockRejectedValueOnce(erroRateLimit())
      .mockResolvedValueOnce(respostaGroq('Bateria boa.\nFONTES: [1]'))
    await askGroq('Como é a bateria?', mockComments)
    const primaria = create.mock.calls[0][0]
    const secundaria = create.mock.calls[1][0]
    expect(secundaria.messages).toEqual(primaria.messages)
    expect(secundaria.temperature).toBe(primaria.temperature)
    expect(secundaria.max_tokens).toBe(primaria.max_tokens)
  })

  it('parseia resposta e fontes vindas do modelo secundário', async () => {
    create
      .mockRejectedValueOnce(erroRateLimit())
      .mockResolvedValueOnce(respostaGroq('A bateria dura o dia todo.\nFONTES: [1, 3]'))
    const result = await askGroq('Como é a bateria?', mockComments)
    expect(result.resposta.trim()).toBe('A bateria dura o dia todo.')
    expect(result.indicesFonte).toEqual([0, 2])
    expect(result.comentarios_fonte.map(c => c.id)).toEqual(['1', '3'])
  })

  it('não aciona o secundário quando o erro do primário não é 429', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('server error'), { status: 500 }))
    await expect(askGroq('Como é a bateria?', mockComments)).rejects.toThrow('server error')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('propaga o erro quando o secundário também falha', async () => {
    create
      .mockRejectedValueOnce(erroRateLimit())
      .mockRejectedValueOnce(new Error('secundário fora do ar'))
    await expect(askGroq('Como é a bateria?', mockComments)).rejects.toThrow(
      'secundário fora do ar'
    )
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('devolve resposta vazia sem quebrar se o secundário não trouxer conteúdo', async () => {
    create.mockRejectedValueOnce(erroRateLimit()).mockResolvedValueOnce({ choices: [] })
    const result = await askGroq('Como é a bateria?', mockComments)
    expect(result.modelo).toBe(FALLBACK_MODEL)
    expect(result.resposta).toBe('')
    expect(result.comentarios_fonte).toHaveLength(0)
  })
})
