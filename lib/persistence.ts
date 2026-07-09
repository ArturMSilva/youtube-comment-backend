import { randomUUID } from 'node:crypto'
import { interacoes, interacaoComentarios } from '../db/schema'
import type { Database } from './db'
import type { Comment } from '../types'

export interface InteracaoParaSalvar {
  videoId: string | null
  pergunta: string
  resposta: string
  metodo: 'keyword' | 'semantic'
  modeloLlm: string
  totalComentariosRecebidos: number
  latenciaFiltroMs: number
  /** Os comentários filtrados, já na ordem do ranking de relevância. */
  comentariosFiltrados: Comment[]
  /** Índices 0-based, dentro de comentariosFiltrados, que o LLM citou. */
  indicesFonte: number[]
}

type LinhaInteracao = typeof interacoes.$inferInsert
type LinhaComentario = typeof interacaoComentarios.$inferInsert

export function montarLinhas(
  id: string,
  dados: InteracaoParaSalvar
): { interacao: LinhaInteracao; comentarios: LinhaComentario[] } {
  const fontes = new Set(dados.indicesFonte)

  return {
    interacao: {
      id,
      videoId: dados.videoId,
      pergunta: dados.pergunta,
      resposta: dados.resposta,
      metodo: dados.metodo,
      modeloLlm: dados.modeloLlm,
      totalComentariosRecebidos: dados.totalComentariosRecebidos,
      latenciaFiltroMs: dados.latenciaFiltroMs,
    },
    comentarios: dados.comentariosFiltrados.map((c, i) => ({
      interacaoId: id,
      comentarioId: c.id,
      texto: c.text,
      likeCount: c.likeCount,
      posicao: i + 1, // ranking é 1-based
      foiFonte: fontes.has(i),
    })),
  }
}

export async function salvarInteracao(db: Database, dados: InteracaoParaSalvar): Promise<string> {
  const id = randomUUID()
  const linhas = montarLinhas(id, dados)

  const queries: any[] = [db.insert(interacoes).values(linhas.interacao)]
  if (linhas.comentarios.length > 0) {
    queries.push(db.insert(interacaoComentarios).values(linhas.comentarios))
  }

  // neon-http não suporta db.transaction(); batch envia tudo numa única transação HTTP
  await db.batch(queries as [any, ...any[]])

  return id
}
