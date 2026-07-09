import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/retrieval', () => ({
  selectRelevantComments: vi.fn(async (_m, _p, comentarios) => comentarios),
}))
vi.mock('../lib/llm', () => ({
  askGroq: vi.fn(async () => ({
    resposta: 'Dura o dia todo.',
    comentarios_fonte: [{ id: 'a', text: 'Bateria boa', likeCount: 10 }],
    indicesFonte: [0],
    modelo: 'llama-3.3-70b-versatile',
  })),
}))
vi.mock('../lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../lib/persistence', () => ({ salvarInteracao: vi.fn(async () => 'uuid-1') }))

import handler from '../api/ask'
import { salvarInteracao } from '../lib/persistence'

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
      modeloLlm: 'llama-3.3-70b-versatile',
      totalComentariosRecebidos: 1,
      indicesFonte: [0],
    })
    expect(typeof dados.latenciaFiltroMs).toBe('number')
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
