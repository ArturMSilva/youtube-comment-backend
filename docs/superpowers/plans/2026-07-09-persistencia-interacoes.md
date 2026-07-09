# Persistência de Interações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir cada interação de `/api/ask` (pergunta, resposta, 30 comentários filtrados, quais foram fonte, videoId e metadados) em Postgres no Neon, para servir de base a pesquisas futuras.

**Architecture:** Drizzle ORM sobre o driver HTTP do Neon. `db/schema.ts` é a fonte da verdade dos tipos. `lib/persistence.ts` é o único ponto que escreve no banco e recebe o client por injeção. A escrita é best-effort: `api/ask.ts` a envolve em `try/catch` que só loga, e responde 200 mesmo se o banco falhar.

**Tech Stack:** TypeScript, Vercel serverless, `drizzle-orm@0.45.2`, `@neondatabase/serverless@1.1.0`, `drizzle-kit@0.31.10`, Vitest.

## Global Constraints

- Mensagens de commit em **português**, prefixo `type: descrição`, **sem** trailer `Co-Authored-By`.
- `DATABASE_URL` só em `.env` (gitignored) e no dashboard da Vercel. Nunca no código.
- O contrato HTTP de `/api/ask` **não muda**: a resposta continua sendo exatamente `{ resposta, comentarios_fonte }`.
- Persistência é **best-effort**: falha de banco nunca vira erro HTTP.
- `db.transaction()` **não funciona** no driver `neon-http` (lança exceção). Usar `db.batch([...])`.
- `interacoes.id` é `UUID` gerado com `crypto.randomUUID()` na aplicação, nunca pelo banco.
- Colunas em `snake_case` no banco, propriedades em `camelCase` no TypeScript.
- CORS não muda.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `db/schema.ts` (criar) | Definição das duas tabelas em Drizzle. Fonte da verdade dos tipos. |
| `lib/db.ts` (criar) | Instancia o client Neon HTTP + Drizzle. Exporta o tipo `Database`. |
| `lib/persistence.ts` (criar) | `montarLinhas` (pura) e `salvarInteracao` (escreve). Único ponto de escrita. |
| `drizzle.config.ts` (criar) | Config do drizzle-kit para gerar migrations. |
| `drizzle/` (gerado) | SQL das migrations. |
| `lib/llm.ts` (modificar) | Passa a expor `indicesFonte` e `modelo`. |
| `types.ts` (modificar) | `AskRequest.videoId?`, tipos `ParsedResponse` e `GroqResult`. |
| `api/ask.ts` (modificar) | Cronometra o filtro, chama `salvarInteracao` em try/catch. |
| `../youtube-comment-extension/service-worker.js` (modificar) | Repassa `videoId` no body do POST. |

---

## Task 1: Schema, client e migration

**Files:**
- Create: `db/schema.ts`, `lib/db.ts`, `drizzle.config.ts`
- Modify: `package.json` (scripts), `.env.example`
- Generated: `drizzle/0000_*.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `interacoes`, `interacaoComentarios` (tabelas Drizzle); `getDb(): Database`; `type Database = NeonHttpDatabase<typeof schema>`.

- [ ] **Step 1: Criar `db/schema.ts`**

```ts
import {
  pgTable, uuid, text, integer, smallint, boolean, timestamp, bigserial, unique, index,
} from 'drizzle-orm/pg-core'

export const interacoes = pgTable('interacoes', {
  id: uuid('id').primaryKey(),
  videoId: text('video_id'),
  pergunta: text('pergunta').notNull(),
  resposta: text('resposta').notNull(),
  metodo: text('metodo', { enum: ['keyword', 'semantic'] }).notNull(),
  modeloLlm: text('modelo_llm'),
  totalComentariosRecebidos: integer('total_comentarios_recebidos').notNull(),
  latenciaFiltroMs: integer('latencia_filtro_ms'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxVideo: index('idx_int_video').on(t.videoId),
  idxMetodo: index('idx_int_metodo').on(t.metodo),
  idxCriadoEm: index('idx_int_criado_em').on(t.criadoEm),
}))

export const interacaoComentarios = pgTable('interacao_comentarios', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  interacaoId: uuid('interacao_id')
    .notNull()
    .references(() => interacoes.id, { onDelete: 'cascade' }),
  comentarioId: text('comentario_id').notNull(),
  texto: text('texto').notNull(),
  likeCount: integer('like_count').notNull(),
  posicao: smallint('posicao').notNull(),
  foiFonte: boolean('foi_fonte').notNull().default(false),
}, (t) => ({
  posicaoUnica: unique('uq_ic_interacao_posicao').on(t.interacaoId, t.posicao),
  idxInteracao: index('idx_ic_interacao').on(t.interacaoId),
}))
```

- [ ] **Step 2: Criar `lib/db.ts`**

```ts
import { neon } from '@neondatabase/serverless'
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from '../db/schema'

export type Database = NeonHttpDatabase<typeof schema>

let cached: Database | null = null

export function getDb(): Database {
  if (cached) return cached
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL não configurada')
  cached = drizzle(neon(url), { schema })
  return cached
}
```

- [ ] **Step 3: Criar `drizzle.config.ts`**

```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config
```

- [ ] **Step 4: Adicionar scripts ao `package.json`**

Dentro de `"scripts"`:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 5: Adicionar `DATABASE_URL` ao `.env.example`**

```
DATABASE_URL=postgresql://user:senha@host.neon.tech/dbname?sslmode=require
```

- [ ] **Step 6: Gerar a migration e conferir o SQL**

Run: `npx drizzle-kit generate`
Expected: cria `drizzle/0000_<nome>.sql`. Abrir o arquivo e confirmar que contém
`CREATE TABLE "interacoes"` com `"id" uuid PRIMARY KEY NOT NULL`,
`CREATE TABLE "interacao_comentarios"` com `"interacao_id" uuid NOT NULL`,
a constraint `uq_ic_interacao_posicao` e os quatro índices.

- [ ] **Step 7: Verificar que o TypeScript compila**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add db/schema.ts lib/db.ts drizzle.config.ts drizzle/ package.json package-lock.json .env.example
git commit -m "feat: adiciona schema drizzle e client do neon"
```

---

## Task 2: `lib/llm.ts` expõe `indicesFonte` e `modelo`

Hoje `parseResponse` resolve `FONTES: [1,3,7]` em `Comment[]` e **descarta os índices**. A coluna `foi_fonte` é marcada por posição no ranking, então os índices são necessários. E `askGroq` troca de modelo silenciosamente em 429 — quem chamou precisa saber qual respondeu.

**Files:**
- Modify: `types.ts`, `lib/llm.ts`
- Test: `tests/llm.test.ts`

**Interfaces:**
- Consumes: `Comment` de `types.ts`.
- Produces:
  - `interface ParsedResponse { resposta: string; comentarios_fonte: Comment[]; indicesFonte: number[] }` — `indicesFonte` é **0-based** sobre a lista passada a `parseResponse`.
  - `interface GroqResult extends ParsedResponse { modelo: string }`
  - `parseResponse(raw: string, comentarios: Comment[]): ParsedResponse`
  - `askGroq(pergunta: string, comentarios: Comment[]): Promise<GroqResult>`
  - `AskResponse` continua `{ resposta, comentarios_fonte }` e é o que vai no HTTP.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `tests/llm.test.ts` (o arquivo já tem `mockComments` no topo):

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/llm.test.ts`
Expected: FAIL — `expected undefined to equal [ 0, 2 ]` (a propriedade `indicesFonte` não existe).

- [ ] **Step 3: Atualizar `types.ts`**

Substituir o conteúdo por:

```ts
export interface Comment {
  id: string
  text: string
  likeCount: number
}

export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
  method?: 'keyword' | 'semantic'
  videoId?: string
}

/** Resposta enviada ao cliente HTTP. Não expõe internos. */
export interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
}

/** Saída de parseResponse: inclui os índices usados internamente pela persistência. */
export interface ParsedResponse extends AskResponse {
  /** Índices 0-based na lista de comentários passada a parseResponse. */
  indicesFonte: number[]
}

/** Saída de askGroq: acrescenta qual modelo Groq de fato respondeu. */
export interface GroqResult extends ParsedResponse {
  modelo: string
}
```

- [ ] **Step 4: Atualizar `lib/llm.ts`**

Trocar o import de tipos e as duas funções:

```ts
import type { Comment, ParsedResponse, GroqResult } from '../types'

export function parseResponse(raw: string, comentarios: Comment[]): ParsedResponse {
  const fontesMatch = raw.match(/FONTES:\s*\[([^\]]+)\]/)
  const resposta = raw.replace(/FONTES:.*$/s, '').trim()

  let indicesFonte: number[] = []
  if (fontesMatch) {
    indicesFonte = fontesMatch[1]
      .split(',')
      .map(s => parseInt(s.trim(), 10) - 1) // 1-based → 0-based
      .filter(i => i >= 0 && i < comentarios.length)
  }

  return {
    resposta,
    comentarios_fonte: indicesFonte.map(i => comentarios[i]),
    indicesFonte,
  }
}

export async function askGroq(pergunta: string, comentarios: Comment[]): Promise<GroqResult> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const prompt = buildPrompt(pergunta, comentarios)

  const tryModel = async (model: string): Promise<string> => {
    const completion = await groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1024,
    })
    return completion.choices[0]?.message?.content ?? ''
  }

  let raw: string
  let modelo = PRIMARY_MODEL
  try {
    raw = await tryModel(PRIMARY_MODEL)
  } catch (error: any) {
    if (error?.status === 429) {
      // Rate limit no modelo primário: tenta o fallback
      modelo = FALLBACK_MODEL
      raw = await tryModel(FALLBACK_MODEL)
    } else {
      throw error
    }
  }

  return { ...parseResponse(raw, comentarios), modelo }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npx vitest run tests/llm.test.ts`
Expected: PASS, 7 testes (os 4 antigos continuam passando).

- [ ] **Step 6: Verificar tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add types.ts lib/llm.ts tests/llm.test.ts
git commit -m "feat: expoe indicesFonte e modelo usado no askGroq"
```

---

## Task 3: `lib/persistence.ts`

Separa uma função **pura** (`montarLinhas`) da função que **escreve** (`salvarInteracao`). A pura carrega toda a lógica interessante — posição no ranking e marcação de fonte — e é testável sem banco.

**Files:**
- Create: `lib/persistence.ts`
- Test: `tests/persistence.test.ts`

**Interfaces:**
- Consumes: `Comment` (`types.ts`), `interacoes`/`interacaoComentarios` (`db/schema.ts`), `Database` (`lib/db.ts`).
- Produces:
  - `interface InteracaoParaSalvar { videoId: string | null; pergunta: string; resposta: string; metodo: 'keyword' | 'semantic'; modeloLlm: string; totalComentariosRecebidos: number; latenciaFiltroMs: number; comentariosFiltrados: Comment[]; indicesFonte: number[] }`
  - `montarLinhas(id: string, dados: InteracaoParaSalvar): { interacao: LinhaInteracao; comentarios: LinhaComentario[] }`
  - `salvarInteracao(db: Database, dados: InteracaoParaSalvar): Promise<string>` — devolve o UUID gerado.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/persistence.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/persistence.test.ts`
Expected: FAIL — `Failed to load ../lib/persistence` (o arquivo não existe).

- [ ] **Step 3: Criar `lib/persistence.ts`**

```ts
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

export async function salvarInteracao(
  db: Database,
  dados: InteracaoParaSalvar
): Promise<string> {
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
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run tests/persistence.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 5: Verificar tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add lib/persistence.ts tests/persistence.test.ts
git commit -m "feat: adiciona salvarInteracao com escrita atomica via batch"
```

---

## Task 4: Ligar tudo em `api/ask.ts`

**Files:**
- Modify: `api/ask.ts`
- Test: `tests/ask.test.ts` (criar)

**Interfaces:**
- Consumes: `selectRelevantComments`, `askGroq` (agora devolve `GroqResult`), `salvarInteracao`, `getDb`.
- Produces: handler HTTP. Resposta inalterada: `{ resposta, comentarios_fonte }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/ask.test.ts`:

```ts
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
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: unknown) => { res.body = b; return res })
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

beforeEach(() => vi.clearAllMocks())

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/ask.test.ts`
Expected: FAIL — `salvarInteracao` não foi chamada (o handler ainda não persiste).

- [ ] **Step 3: Reescrever `api/ask.ts`**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCORS } from '../lib/cors'
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
import { getDb } from '../lib/db'
import { salvarInteracao } from '../lib/persistence'
import type { AskRequest } from '../types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCORS(req, res, 'POST, OPTIONS')) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' })
  }

  const body = req.body as AskRequest

  if (!body?.pergunta?.trim()) {
    return res.status(400).json({ error: 'pergunta é obrigatória' })
  }
  if (!Array.isArray(body?.comentarios) || body.comentarios.length === 0) {
    return res.status(400).json({ error: 'comentarios não pode estar vazio' })
  }

  const sanitized = body.pergunta.slice(0, 500) // previne prompt injection por tamanho
  const method = body.method === 'semantic' ? 'semantic' : 'keyword' // default: keyword

  let relevantes
  let latenciaFiltroMs: number
  try {
    const inicio = Date.now()
    relevantes = await selectRelevantComments(method, sanitized, body.comentarios, 30)
    latenciaFiltroMs = Date.now() - inicio
  } catch (error) {
    // Caminho semântico: falha do Gemini vira erro explícito (sem fallback para keyword)
    return res.status(502).json({ error: 'Falha ao gerar embeddings (busca semântica)' })
  }

  const resultado = await askGroq(sanitized, relevantes)

  // Persistência é best-effort: nunca derruba a resposta ao usuário.
  try {
    await salvarInteracao(getDb(), {
      videoId: body.videoId ?? null,
      pergunta: sanitized,
      resposta: resultado.resposta,
      metodo: method,
      modeloLlm: resultado.modelo,
      totalComentariosRecebidos: body.comentarios.length,
      latenciaFiltroMs,
      comentariosFiltrados: relevantes,
      indicesFonte: resultado.indicesFonte,
    })
  } catch (error) {
    console.error('Falha ao persistir interação:', error)
  }

  return res.status(200).json({
    resposta: resultado.resposta,
    comentarios_fonte: resultado.comentarios_fonte,
  })
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run tests/ask.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Rodar a suíte inteira e o lint**

Run: `npm test && npm run lint`
Expected: todos os testes passam, sem erro de tipo.

- [ ] **Step 6: Commit**

```bash
git add api/ask.ts tests/ask.test.ts
git commit -m "feat: persiste cada interacao do /api/ask no neon"
```

---

## Task 5: Extensão envia o `videoId`

Hoje `service-worker.js:174` desestrutura `videoId` da mensagem e a linha 188 chama `callLLM(question, comments)` sem passá-lo — o id nunca chega ao backend.

**Files:**
- Modify: `../youtube-comment-extension/service-worker.js`

**Interfaces:**
- Consumes: `POST /api/ask` aceita `videoId?: string` (Task 2).
- Produces: body do POST com `videoId`.

- [ ] **Step 1: Ler `callLLM` para achar a assinatura exata**

Run: `grep -n "callLLM" ../youtube-comment-extension/service-worker.js`

- [ ] **Step 2: Acrescentar o parâmetro `videoId` a `callLLM`**

Alterar a assinatura para `async function callLLM(question, comments, videoId)` e incluir
`videoId` no objeto passado a `JSON.stringify` do body do `fetch`. Manter o resto igual.

- [ ] **Step 3: Passar o `videoId` na chamada (linha ~188)**

```js
const response = await callLLM(question, comments, videoId);
```

- [ ] **Step 4: Verificar manualmente**

Recarregar a extensão em `chrome://extensions/`, abrir um vídeo do YouTube, coletar
comentários e fazer uma pergunta. Na aba Network do service worker, confirmar que o body do
POST para `/api/ask` contém `"videoId"`.

- [ ] **Step 5: Commit (no repo da extensão)**

```bash
cd ../youtube-comment-extension
git add service-worker.js
git commit -m "feat: envia videoId no corpo do POST /api/ask"
```

---

## Task 6: Documentação

**Files:**
- Modify: `CLAUDE.md` (backend), `../youtube-comment-extension/CLAUDE.md`, `README.md`

- [ ] **Step 1: `CLAUDE.md` do backend**

Na tabela de env vars, acrescentar `DATABASE_URL` (Neon, usada por `lib/db.ts`). Em
"Key Constraints", acrescentar: persistência é best-effort e nunca vira erro HTTP; `neon-http`
não suporta `db.transaction()` — usar `db.batch()`. Nos comandos, acrescentar
`npm run db:generate`, `db:migrate`, `db:studio`.

- [ ] **Step 2: `CLAUDE.md` da extensão**

Na seção "Extension → Backend", registrar que o `ASK_LLM` repassa `videoId` no body do POST.
Na estrutura de arquivos do backend, acrescentar `db/schema.ts`, `lib/db.ts`, `lib/persistence.ts`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: documenta persistencia das interacoes"
```

---

## Passos manuais (fora do código)

Não são automatizáveis e devem ser feitos por você:

1. Provisionar o Postgres no Neon (via Vercel Marketplace, ou direto em neon.tech).
2. Copiar a connection string para `youtube-comment-backend/.env` como `DATABASE_URL`.
3. Rodar `npm run db:migrate` para criar as tabelas.
4. Adicionar `DATABASE_URL` às env vars do projeto na Vercel e fazer novo deploy.
5. Atualizar `BACKEND_URL` em `config.js` se a URL do deploy mudar.

---

## Self-Review

**Cobertura do spec:** schema → Task 1. `metodo`/`modelo_llm`/`total_comentarios_recebidos`/`latencia_filtro_ms` → Tasks 2 e 4. Atomicidade via `batch` + UUID → Tasks 1 e 3. Best-effort → Task 4. `video_id` nulo → Tasks 3 e 4. Mudança na extensão → Task 5. `DATABASE_URL`/`.env.example` → Task 1. Testes do spec → Tasks 2, 3, 4. Ética: nada a implementar (nenhum dado de autor é coletado).

**Consistência de tipos:** `indicesFonte` (0-based) atravessa `parseResponse` → `GroqResult` → `InteracaoParaSalvar` → `montarLinhas`, onde vira `posicao` 1-based e `foiFonte`. `salvarInteracao(db, dados)` tem o `db` como primeiro parâmetro em todos os usos e testes.
