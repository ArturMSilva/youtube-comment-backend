import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  bigserial,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core'

export const interacoes = pgTable(
  'interacoes',
  {
    id: uuid('id').primaryKey(),
    videoId: text('video_id'),
    pergunta: text('pergunta').notNull(),
    resposta: text('resposta').notNull(),
    metodo: text('metodo', { enum: ['keyword', 'semantic'] }).notNull(),
    modeloLlm: text('modelo_llm'),
    totalComentariosRecebidos: integer('total_comentarios_recebidos').notNull(),
    latenciaFiltroMs: integer('latencia_filtro_ms'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  t => ({
    idxVideo: index('idx_int_video').on(t.videoId),
    idxMetodo: index('idx_int_metodo').on(t.metodo),
    idxCriadoEm: index('idx_int_criado_em').on(t.criadoEm),
    // O enum do Drizzle só vale em tempo de compilação; a garantia precisa existir no banco.
    metodoValido: check('ck_int_metodo', sql`${t.metodo} IN ('keyword', 'semantic')`),
  })
)

export const interacaoComentarios = pgTable(
  'interacao_comentarios',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    interacaoId: uuid('interacao_id')
      .notNull()
      .references(() => interacoes.id, { onDelete: 'cascade' }),
    comentarioId: text('comentario_id').notNull(),
    texto: text('texto').notNull(),
    likeCount: integer('like_count').notNull(),
    posicao: smallint('posicao').notNull(),
    foiFonte: boolean('foi_fonte').notNull().default(false),
  },
  t => ({
    posicaoUnica: unique('uq_ic_interacao_posicao').on(t.interacaoId, t.posicao),
    idxInteracao: index('idx_ic_interacao').on(t.interacaoId),
  })
)
