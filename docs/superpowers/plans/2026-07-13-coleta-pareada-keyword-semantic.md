# Coleta pareada keyword vs semantic — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer cada pergunta real rodar os métodos `keyword` e `semantic` sobre os mesmos comentários e gravar duas linhas linkadas (`par_id`), habilitando o dataset pareado de avaliação do TCC.

**Architecture:** O `/api/ask` ganha um flag `compare`. Com `compare: true`, o handler roda os dois métodos em paralelo (`Promise.allSettled`) sobre os mesmos comentários, persiste cada método bem-sucedido como uma linha `interacoes` com um `par_id` compartilhado (best-effort), e devolve à UI a resposta do semantic (fallback para keyword se o semantic falhar; 502 só se ambos falharem). A extensão apenas passa a enviar `compare: true`.

**Tech Stack:** TypeScript, Vercel serverless (`@vercel/node`), Drizzle ORM + Neon Postgres, Groq SDK, Gemini embeddings, Vitest. Extensão: Chrome MV3 (JS puro).

## Global Constraints

- TDD: teste falhando antes da implementação, em cada task.
- Commits em português, sem tag de co-autoria (convenção do projeto).
- Persistência é best-effort: falha ao gravar no Neon é logada e **nunca** derruba a resposta HTTP.
- `compare` default `false`: sem o flag, `/api/ask` se comporta exatamente como hoje (retrocompatível). O caminho não-compare **não muda de semântica de erro**.
- `par_id` é `uuid` **nullable**; migração aditiva, sem risco para dados existentes.
- Os dois métodos rodam em paralelo via `Promise.allSettled` (não sequencial).
- UI mostra a resposta do semantic; `aviso` só aparece no fallback para keyword.
- Dois repositórios git distintos: backend (`youtube-comment-backend`) e extensão (`youtube-comment-extension`). Cada commit vai no repositório do arquivo tocado.

## Estrutura de arquivos

| Arquivo | Repo | Responsabilidade |
|---|---|---|
| `db/schema.ts` (mod) | backend | Coluna `par_id` + índice `idx_int_par` em `interacoes` |
| `drizzle/00NN_*.sql` (novo, gerado) | backend | Migração aditiva da coluna `par_id` |
| `lib/persistence.ts` (mod) | backend | `InteracaoParaSalvar.parId` + `montarLinhas` grava `par_id` |
| `types.ts` (mod) | backend | `AskRequest.compare?` + `AskResponse.aviso?` |
| `api/ask.ts` (mod) | backend | Helpers `executarMetodo`/`persistirInteracao` + branch `compare` |
| `tests/persistence.test.ts` (mod) | backend | Casos de `par_id` |
| `tests/ask.test.ts` (mod) | backend | Casos do modo compare |
| `service-worker.js` (mod) | extensão | Payload de `callLLM` passa a enviar `compare: true` |

---

### Task 1: Coluna `par_id` no schema e na persistência

**Files:**
- Modify: `youtube-comment-backend/db/schema.ts` (tabela `interacoes`)
- Modify: `youtube-comment-backend/lib/persistence.ts`
- Modify: `youtube-comment-backend/tests/persistence.test.ts`
- Create (gerado): `youtube-comment-backend/drizzle/00NN_<nome>.sql`

**Interfaces:**
- Consumes: schema `interacoes` atual, `InteracaoParaSalvar`, `montarLinhas(id, dados)`.
- Produces:
  - `interacoes` com coluna `par_id uuid` (nullable) e índice `idx_int_par`.
  - `InteracaoParaSalvar` com campo opcional `parId?: string | null`.
  - `montarLinhas` grava `parId` na linha de `interacoes` (default `null`).

- [ ] **Step 1: Escrever os testes falhando** (adicionar ao final do `describe('montarLinhas', …)` em `tests/persistence.test.ts`)

```ts
  it('grava par_id quando presente', () => {
    const { interacao } = montarLinhas('uuid-1', { ...base, parId: 'par-xyz' })
    expect(interacao.parId).toBe('par-xyz')
  })

  it('grava par_id nulo quando ausente', () => {
    const { interacao } = montarLinhas('uuid-1', base)
    expect(interacao.parId).toBeNull()
  })
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npm test -- persistence`
Expected: FALHA — `interacao.parId` é `undefined` (campo ainda não existe no schema nem em `montarLinhas`).

- [ ] **Step 3: Adicionar a coluna e o índice no schema** (`db/schema.ts`, dentro de `pgTable('interacoes', …)`)

Adicionar a coluna logo após `id`:

```ts
    id: uuid('id').primaryKey(),
    parId: uuid('par_id'),
    videoId: text('video_id'),
```

E adicionar o índice no objeto de constraints (junto aos outros `index(...)`):

```ts
    idxPar: index('idx_int_par').on(t.parId),
```

- [ ] **Step 4: Gravar `parId` em `montarLinhas`** (`lib/persistence.ts`)

No tipo `InteracaoParaSalvar`, adicionar o campo opcional:

```ts
export interface InteracaoParaSalvar {
  videoId: string | null
  parId?: string | null
  pergunta: string
```

Na montagem da linha `interacao`, adicionar `parId` (logo após `id`):

```ts
    interacao: {
      id,
      parId: dados.parId ?? null,
      videoId: dados.videoId,
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npm test -- persistence`
Expected: PASS (todos os casos de `montarLinhas` e `salvarInteracao`, incluindo os 2 novos).

- [ ] **Step 6: Gerar a migração**

Run: `npm run db:generate`
Expected: cria um arquivo novo em `drizzle/` (ex.: `drizzle/0001_<nome>.sql`) com `ALTER TABLE "interacoes" ADD COLUMN "par_id" uuid;` e `CREATE INDEX "idx_int_par" …`. (Não aplica no banco ainda — isso é feito na Task 3.)

- [ ] **Step 7: Commit**

```bash
cd youtube-comment-backend
git add db/schema.ts lib/persistence.ts tests/persistence.test.ts drizzle/
git commit -m "feat: adiciona par_id para linkar interacoes pareadas"
```

---

### Task 2: Modo `compare` no `/api/ask`

**Files:**
- Modify: `youtube-comment-backend/types.ts`
- Modify: `youtube-comment-backend/api/ask.ts`
- Modify: `youtube-comment-backend/tests/ask.test.ts`

**Interfaces:**
- Consumes: `selectRelevantComments(method, pergunta, comentarios, topN)`, `askGroq(pergunta, comentarios)` → `GroqResult` (`{ resposta, comentarios_fonte, indicesFonte, modelo }`), `salvarInteracao(db, dados)`, `getDb()`, `InteracaoParaSalvar.parId` (da Task 1).
- Produces:
  - `AskRequest.compare?: boolean`; `AskResponse.aviso?: string`.
  - Comportamento HTTP do modo compare conforme a tabela de erro do spec.

- [ ] **Step 1: Escrever os testes falhando** (em `tests/ask.test.ts`)

Primeiro, ampliar imports e o `beforeEach` para permitir sobrescrever o comportamento por método sem vazar entre testes. Adicionar aos imports existentes:

```ts
import { selectRelevantComments } from '../lib/retrieval'
import { askGroq } from '../lib/llm'
```

Substituir o `beforeEach` atual por (re-estabelece os defaults a cada teste):

```ts
beforeEach(() => {
  vi.clearAllMocks()
  ;(selectRelevantComments as any).mockImplementation(async (_m: string, _p: string, c: any) => c)
  ;(askGroq as any).mockImplementation(async () => ({
    resposta: 'Dura o dia todo.',
    comentarios_fonte: [{ id: 'a', text: 'Bateria boa', likeCount: 10 }],
    indicesFonte: [0],
    modelo: 'llama-3.3-70b-versatile',
  }))
  ;(salvarInteracao as any).mockImplementation(async () => 'uuid-1')
})
```

Adicionar um novo `describe` ao final do arquivo:

```ts
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
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npm test -- ask`
Expected: FALHA nos 4 casos novos — `compare` é ignorado, então grava 1 linha sem `par_id` e responde sempre com o caminho único.

- [ ] **Step 3: Estender os tipos** (`types.ts`)

```ts
export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
  method?: 'keyword' | 'semantic'
  compare?: boolean
  videoId?: string
}

export interface AskResponse {
  resposta: string
  comentarios_fonte: Comment[]
  aviso?: string
}
```

- [ ] **Step 4: Implementar os helpers e o branch compare** (`api/ask.ts`)

Ampliar os imports do topo:

```ts
import { randomUUID } from 'node:crypto'
import type { AskRequest, Comment, GroqResult } from '../types'
```

Adicionar, entre os imports e o `export default`, os dois helpers:

```ts
type ResultadoMetodo = {
  metodo: 'keyword' | 'semantic'
  relevantes: Comment[]
  latenciaFiltroMs: number
  resultado: GroqResult
}

async function executarMetodo(
  metodo: 'keyword' | 'semantic',
  pergunta: string,
  comentarios: Comment[]
): Promise<ResultadoMetodo> {
  const inicio = Date.now()
  const relevantes = await selectRelevantComments(metodo, pergunta, comentarios, 30)
  const latenciaFiltroMs = Date.now() - inicio
  const resultado = await askGroq(pergunta, relevantes)
  return { metodo, relevantes, latenciaFiltroMs, resultado }
}

async function persistirInteracao(
  r: ResultadoMetodo,
  ctx: { videoId: string | null; pergunta: string; totalComentariosRecebidos: number; parId: string | null }
): Promise<void> {
  // best-effort: nunca derruba a resposta ao usuário
  try {
    await salvarInteracao(getDb(), {
      videoId: ctx.videoId,
      parId: ctx.parId,
      pergunta: ctx.pergunta,
      resposta: r.resultado.resposta,
      metodo: r.metodo,
      modeloLlm: r.resultado.modelo,
      totalComentariosRecebidos: ctx.totalComentariosRecebidos,
      latenciaFiltroMs: r.latenciaFiltroMs,
      comentariosFiltrados: r.relevantes,
      indicesFonte: r.resultado.indicesFonte,
    })
  } catch (error) {
    console.error('Falha ao persistir interação:', error)
  }
}
```

No corpo do handler, logo após a linha `const sanitized = body.pergunta.slice(0, 500)`, adicionar o contexto-base e o branch compare (antes da linha `const method = …` atual):

```ts
  const ctxBase = {
    videoId: body.videoId ?? null,
    pergunta: sanitized,
    totalComentariosRecebidos: body.comentarios.length,
  }

  if (body.compare === true) {
    const parId = randomUUID()
    const [kw, sem] = await Promise.allSettled([
      executarMetodo('keyword', sanitized, body.comentarios),
      executarMetodo('semantic', sanitized, body.comentarios),
    ])

    if (kw.status === 'fulfilled') await persistirInteracao(kw.value, { ...ctxBase, parId })
    if (sem.status === 'fulfilled') await persistirInteracao(sem.value, { ...ctxBase, parId })

    if (sem.status === 'fulfilled') {
      return res.status(200).json({
        resposta: sem.value.resultado.resposta,
        comentarios_fonte: sem.value.resultado.comentarios_fonte,
      })
    }
    if (kw.status === 'fulfilled') {
      return res.status(200).json({
        resposta: kw.value.resultado.resposta,
        comentarios_fonte: kw.value.resultado.comentarios_fonte,
        aviso: 'Busca semântica indisponível; resposta gerada por busca por palavra-chave.',
      })
    }
    return res.status(502).json({ error: 'Falha ao gerar resposta (ambos os métodos falharam)' })
  }
```

Por fim, no caminho não-compare (o código atual), trocar apenas o bloco de persistência inline pela chamada ao helper, mantendo o resto igual. Substituir:

```ts
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
```

por:

```ts
  const resultado = await askGroq(sanitized, relevantes)

  await persistirInteracao(
    { metodo: method, relevantes, latenciaFiltroMs, resultado },
    { ...ctxBase, parId: null }
  )
```

(Mantém `method`, `relevantes` e `latenciaFiltroMs` como estão hoje; `askGroq` continua fora do `try/catch` do filtro, preservando a semântica de erro atual do caminho não-compare.)

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npm test -- ask`
Expected: PASS — os 4 casos novos + os 4 casos existentes (o teste que grava com `method: 'semantic'` continua passando; `toMatchObject` ignora o campo extra `parId`).

- [ ] **Step 6: Rodar a suíte inteira e o lint**

Run: `npm test`
Expected: PASS (todos os arquivos, ~49 testes).

Run: `npm run lint`
Expected: sem erros de tipo.

- [ ] **Step 7: Commit**

```bash
cd youtube-comment-backend
git add types.ts api/ask.ts tests/ask.test.ts
git commit -m "feat: modo compare no /api/ask (roda keyword e semantic e grava o par)"
```

---

### Task 3: Extensão envia `compare: true` + verificação ponta a ponta

**Files:**
- Modify: `youtube-comment-extension/service-worker.js` (payload de `callLLM`, ~linha 47)

**Interfaces:**
- Consumes: endpoint `/api/ask` com suporte a `compare` (Task 2).
- Produces: toda pergunta da extensão dispara o modo compare (2 linhas por pergunta no banco).

> Nota: a extensão não tem runner de testes automatizado; a verificação desta task é manual, ponta a ponta, e fecha o item pendente "teste ponta-a-ponta local nunca rodou com dado real".

- [ ] **Step 1: Enviar `compare: true` no payload** (`service-worker.js`, função `callLLM`)

Trocar o objeto `payload` (hoje sem `compare`) por:

```js
  const payload = {
    pergunta: question,
    comentarios: comments.map(c => ({
      id: c.id,
      text: c.textOriginal || c.text,
      likeCount: c.likeCount || 0
    })),
    videoId: videoId,
    compare: true
  };
```

- [ ] **Step 2: Aplicar a migração no Neon local**

Run (no backend):

```bash
cd youtube-comment-backend
npm run db:migrate
```

Expected: aplica a migração da Task 1; a coluna `par_id` e o índice `idx_int_par` passam a existir na tabela `interacoes` do banco local. (Requer `DATABASE_URL` no `.env`, já presente.)

- [ ] **Step 3: Subir o backend local**

Run (no backend, terminal dedicado):

```bash
npm run dev:local
```

Expected: `dev server (shim Vercel) ouvindo em http://localhost:3000`.

- [ ] **Step 4: Verificação ponta a ponta pelo Chrome**

1. Recarregar a extensão em `chrome://extensions` (modo unpacked).
2. Abrir um vídeo do YouTube, coletar comentários e fazer uma pergunta real.
3. Confirmar na UI que uma resposta aparece (será a do semantic).

- [ ] **Step 5: Confirmar o par no banco**

Run (no backend):

```bash
npm run db:studio
```

Expected: na tabela `interacoes`, a última pergunta gerou **duas** linhas com o **mesmo** `par_id` e `metodo` distinto (`keyword` e `semantic`), cada uma com suas linhas em `interacao_comentarios`.

- [ ] **Step 6: Commit** (repositório da extensão)

```bash
cd youtube-comment-extension
git add service-worker.js
git commit -m "feat: extensao aciona modo compare (keyword e semantic por pergunta)"
```

---

## Notas de conclusão

- Ao final das 3 tasks, o Subprojeto A está completo: toda pergunta gera um par keyword/semantic no Neon, e o teste ponta-a-ponta local (antes nunca executado com dado real) está fechado.
- Próximos passos fora deste plano: **Subprojeto B** (tooling de análise — ler o Neon, filtrar por `par_id` com contagem 2, comparar latência/fontes/qualidade) e, se desejado, o deploy na Vercel. Cada um com sua própria spec/plano.
