import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/retrieval', () => ({
  selectRelevantComments: vi.fn(async (_m, _p, comentarios) => comentarios),
}))
vi.mock('../lib/llm', () => ({
  askGroq: vi.fn(async () => ({
    resposta: 'Dura o dia todo.',
    comentarios_fonte: [{ id: 'a', text: 'Bateria boa', likeCount: 10 }],
    indicesFonte: [0],
    modelo: 'openai/gpt-oss-120b',
  })),
}))
vi.mock('../lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../lib/persistence', () => ({ salvarInteracao: vi.fn(async () => 'uuid-1') }))

import handler from '../api/ask'
import { salvarInteracao } from '../lib/persistence'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'

function fakeRes() {
  const res: any = {}
  res.statusCode = 0
  res.body = undefined
  res.setHeader = vi.fn()
  res.status = vi.fn((c: number) => {
    res.statusCode = c
    return res
  })
  res.json = vi.fn((b: unknown) => {
    res.body = b
    return res
  })
  res.end = vi.fn(() => res)
  return res
}

function fakeReq(body: unknown) {
  return {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body,
  } as any
}

const bodyValido = {
  pergunta: 'Como é a bateria?',
  comentarios: [{ id: 'a', text: 'Bateria boa', likeCount: 10 }],
  method: 'semantic',
  videoId: 'abc123',
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(selectRelevantComments as any).mockImplementation(async (_m: string, _p: string, c: any) => c)
  ;(askGroq as any).mockImplementation(async () => ({
    resposta: 'Dura o dia todo.',
    comentarios_fonte: [{ id: 'a', text: 'Bateria boa', likeCount: 10 }],
    indicesFonte: [0],
    modelo: 'openai/gpt-oss-120b',
  }))
  ;(salvarInteracao as any).mockImplementation(async () => 'uuid-1')
})

describe('POST /api/ask', () => {
  it('responde 200 e nao expoe indicesFonte nem modelo', async () => {
    const res = fakeRes()
    await handler(fakeReq(bodyValido), res)
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['comentarios_fonte', 'resposta'])
  })

  it('persiste a interacao com videoId, metodo e modelo', async () => {
    const res = fakeRes()
    await handler(fakeReq(bodyValido), res)
    expect(salvarInteracao).toHaveBeenCalledTimes(1)
    const dados = (salvarInteracao as any).mock.calls[0][1]
    expect(dados).toMatchObject({
      videoId: 'abc123',
      metodo: 'semantic',
      modeloLlm: 'openai/gpt-oss-120b',
      totalComentariosRecebidos: 1,
      indicesFonte: [0],
    })
    expect(typeof dados.latenciaFiltroMs).toBe('number')
  })

  it('persiste o modelo secundario quando o askGroq caiu no fallback', async () => {
    ;(askGroq as any).mockImplementation(async () => ({
      resposta: 'Dura o dia todo.',
      comentarios_fonte: [{ id: 'a', text: 'Bateria boa', likeCount: 10 }],
      indicesFonte: [0],
      modelo: 'openai/gpt-oss-20b',
    }))
    const res = fakeRes()
    await handler(fakeReq(bodyValido), res)
    expect(res.statusCode).toBe(200)
    expect((salvarInteracao as any).mock.calls[0][1].modeloLlm).toBe('openai/gpt-oss-20b')
  })

  it('grava videoId nulo quando o body nao traz videoId', async () => {
    const res = fakeRes()
    await handler(fakeReq({ ...bodyValido, videoId: undefined }), res)
    expect((salvarInteracao as any).mock.calls[0][1].videoId).toBeNull()
  })

  it('responde 200 mesmo se a persistencia falhar', async () => {
    ;(salvarInteracao as any).mockRejectedValueOnce(new Error('neon fora do ar'))
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await handler(fakeReq(bodyValido), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.resposta).toBe('Dura o dia todo.')
    expect(erro).toHaveBeenCalled()
    erro.mockRestore()
  })
})

describe('POST /api/ask — modo compare', () => {
  it('grava 2 linhas com o mesmo par_id e metodos distintos', async () => {
    const res = fakeRes()
    await handler(fakeReq({ ...bodyValido, compare: true }), res)
    expect(salvarInteracao).toHaveBeenCalledTimes(2)
    const d0 = (salvarInteracao as any).mock.calls[0][1]
    const d1 = (salvarInteracao as any).mock.calls[1][1]
    expect(d0.parId).toBeTruthy()
    expect(d0.parId).toBe(d1.parId)
    expect([d0.metodo, d1.metodo].sort()).toEqual(['keyword', 'semantic'])
    expect(res.statusCode).toBe(200)
  })

  it('se o semantic falha, grava so keyword e responde 200 com aviso', async () => {
    ;(selectRelevantComments as any).mockImplementation(async (m: string, _p: string, c: any) => {
      if (m === 'semantic') throw new Error('gemini fora')
      return c
    })
    const res = fakeRes()
    await handler(fakeReq({ ...bodyValido, compare: true }), res)
    expect(salvarInteracao).toHaveBeenCalledTimes(1)
    expect((salvarInteracao as any).mock.calls[0][1].metodo).toBe('keyword')
    expect(res.statusCode).toBe(200)
    expect(res.body.aviso).toBeTruthy()
  })

  it('se o keyword falha, grava so semantic e responde 200 sem aviso', async () => {
    ;(selectRelevantComments as any).mockImplementation(async (m: string, _p: string, c: any) => {
      if (m === 'keyword') throw new Error('erro keyword')
      return c
    })
    const res = fakeRes()
    await handler(fakeReq({ ...bodyValido, compare: true }), res)
    expect(salvarInteracao).toHaveBeenCalledTimes(1)
    expect((salvarInteracao as any).mock.calls[0][1].metodo).toBe('semantic')
    expect(res.statusCode).toBe(200)
    expect(res.body.aviso).toBeUndefined()
  })

  it('se ambos falham, nao grava nada e responde 502', async () => {
    ;(selectRelevantComments as any).mockRejectedValue(new Error('tudo fora'))
    const res = fakeRes()
    await handler(fakeReq({ ...bodyValido, compare: true }), res)
    expect(salvarInteracao).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(502)
  })
})
