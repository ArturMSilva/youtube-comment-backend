import { describe, it, expect, vi } from 'vitest'
import { montarLinhas, salvarInteracao, type InteracaoParaSalvar } from '../lib/persistence'
import type { Comment } from '../types'

const comentarios: Comment[] = [
  { id: 'a', text: 'Bateria dura o dia todo', likeCount: 100 },
  { id: 'b', text: 'Tela é excelente', likeCount: 50 },
  { id: 'c', text: 'Muito rápido', likeCount: 80 },
]

const base: InteracaoParaSalvar = {
  videoId: 'abc123',
  pergunta: 'Como é a bateria?',
  resposta: 'Dura o dia todo.',
  metodo: 'semantic',
  modeloLlm: 'llama-3.3-70b-versatile',
  totalComentariosRecebidos: 500,
  latenciaFiltroMs: 42,
  comentariosFiltrados: comentarios,
  indicesFonte: [0, 2],
}

describe('montarLinhas', () => {
  it('numera posicao a partir de 1, na ordem do ranking', () => {
    const { comentarios: linhas } = montarLinhas('uuid-1', base)
    expect(linhas.map(l => l.posicao)).toEqual([1, 2, 3])
    expect(linhas.map(l => l.comentarioId)).toEqual(['a', 'b', 'c'])
  })

  it('marca foiFonte apenas nos indicesFonte', () => {
    const { comentarios: linhas } = montarLinhas('uuid-1', base)
    expect(linhas.map(l => l.foiFonte)).toEqual([true, false, true])
  })

  it('propaga o interacaoId para todas as linhas filhas', () => {
    const { comentarios: linhas } = montarLinhas('uuid-1', base)
    expect(linhas.every(l => l.interacaoId === 'uuid-1')).toBe(true)
  })

  it('copia os metadados da interacao', () => {
    const { interacao } = montarLinhas('uuid-1', base)
    expect(interacao).toMatchObject({
      id: 'uuid-1',
      videoId: 'abc123',
      metodo: 'semantic',
      modeloLlm: 'llama-3.3-70b-versatile',
      totalComentariosRecebidos: 500,
      latenciaFiltroMs: 42,
    })
  })

  it('aceita videoId nulo', () => {
    const { interacao } = montarLinhas('uuid-1', { ...base, videoId: null })
    expect(interacao.videoId).toBeNull()
  })

  it('nao gera linhas filhas quando nao ha comentarios filtrados', () => {
    const { comentarios: linhas } = montarLinhas('uuid-1', {
      ...base,
      comentariosFiltrados: [],
      indicesFonte: [],
    })
    expect(linhas).toEqual([])
  })
})

function fakeDb() {
  const insert = vi.fn(() => ({ values: vi.fn((v: unknown) => ({ __values: v })) }))
  return { insert, batch: vi.fn(async () => []) } as any
}

describe('salvarInteracao', () => {
  it('escreve interacao e comentarios em um unico batch', async () => {
    const db = fakeDb()
    await salvarInteracao(db, base)
    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(db.batch.mock.calls[0][0]).toHaveLength(2)
  })

  it('devolve o uuid gerado', async () => {
    const db = fakeDb()
    const id = await salvarInteracao(db, base)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('faz um batch de um item quando nao ha comentarios filtrados', async () => {
    const db = fakeDb()
    await salvarInteracao(db, { ...base, comentariosFiltrados: [], indicesFonte: [] })
    expect(db.batch.mock.calls[0][0]).toHaveLength(1)
  })
})
