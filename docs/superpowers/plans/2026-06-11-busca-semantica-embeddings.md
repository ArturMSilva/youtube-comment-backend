# Busca Semântica com Embeddings (Gemini) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar busca semântica por embeddings (Gemini `text-embedding-004`) ao `youtube-comment-backend`, mantendo a busca por keyword lado a lado, selecionável por um campo `method` no request.

**Architecture:** Um novo módulo isolado `lib/embeddings.ts` cuida de vetores (query, documentos em lotes de 100, cosseno). `lib/retrieval.ts` ganha `semanticFilterComments` e um dispatcher `selectRelevantComments` que roteia keyword vs semantic sem tocar no `filterRelevantComments` atual. `api/ask.ts` lê o `method` (default `keyword`) e, se o Gemini falhar no caminho semântico, retorna **erro explícito 502** (sem fallback silencioso). O cliente Gemini é mockado nos testes — nenhuma chamada real.

**Tech Stack:** TypeScript, Vercel Node functions, Vitest, `@google/generative-ai`, Groq SDK (já existente).

**Spec de origem:** `docs/superpowers/specs/2026-06-10-busca-semantica-embeddings-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `lib/embeddings.ts` (criar) | Toda a parte de vetores: `cosineSimilarity`, `chunk`, `embedQuery`, `embedDocuments`. Único ponto que conhece o SDK do Gemini. |
| `tests/embeddings.test.ts` (criar) | Testa cosseno, fatiamento em lotes e as funções de embedding com cliente Gemini mockado. |
| `lib/retrieval.ts` (editar) | Mantém `filterRelevantComments` (keyword) intacto; adiciona `semanticFilterComments` e o dispatcher `selectRelevantComments`. |
| `tests/retrieval.test.ts` (editar) | Estende com ordenação semântica, roteamento do dispatcher e propagação de erro (mockando `lib/embeddings`). |
| `api/ask.ts` (editar) | Lê `method` (default keyword), chama o dispatcher, devolve 502 em falha do Gemini. |
| `types.ts` (editar) | `AskRequest.method?: 'keyword' \| 'semantic'`. |
| `.env.example` (editar) | Documenta `GEMINI_API_KEY`. |
| `package.json` (editar) | Nova dependência `@google/generative-ai`. |

---

## Task 1: Setup — dependência, env e tipo `method`

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env.example`
- Modify: `types.ts:7-10`

- [ ] **Step 1: Instalar a dependência do Gemini**

Run (no diretório `youtube-comment-backend`):
```bash
npm install @google/generative-ai
```
Expected: `@google/generative-ai` aparece em `dependencies` do `package.json` e instala sem erro.

- [ ] **Step 2: Documentar a chave no `.env.example`**

Conteúdo final de `.env.example`:
```
GROQ_API_KEY=sua_chave_aqui
GEMINI_API_KEY=sua_chave_gemini_aqui
```

- [ ] **Step 3: Adicionar o campo `method` ao `AskRequest`**

Em `types.ts`, substituir a interface `AskRequest`:
```ts
export interface AskRequest {
  pergunta: string
  comentarios: Comment[]
  method?: 'keyword' | 'semantic'
}
```

- [ ] **Step 4: Verificar que o projeto ainda compila**

Run: `npm run lint`
Expected: PASS (sem erros de tipo).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example types.ts
git commit -m "chore: add gemini dep, GEMINI_API_KEY and method field"
```

---

## Task 2: `cosineSimilarity` e `chunk` (funções puras)

Começamos pelas funções puras de `lib/embeddings.ts` — fáceis de testar sem mock.

**Files:**
- Create: `lib/embeddings.ts`
- Test: `tests/embeddings.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/embeddings.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { cosineSimilarity, chunk } from '../lib/embeddings'

describe('cosineSimilarity', () => {
  it('retorna 1 para vetores idênticos', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1)
  })

  it('retorna 0 para vetores ortogonais', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('retorna -1 para vetores opostos', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('retorna 0 quando algum vetor é nulo (evita divisão por zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('chunk', () => {
  it('fatia em lotes do tamanho pedido', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i)
    const lotes = chunk(arr, 100)
    expect(lotes).toHaveLength(3)
    expect(lotes[0]).toHaveLength(100)
    expect(lotes[1]).toHaveLength(100)
    expect(lotes[2]).toHaveLength(50)
  })

  it('retorna lista vazia para array vazio', () => {
    expect(chunk([], 100)).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/embeddings.test.ts`
Expected: FAIL — `Failed to resolve import '../lib/embeddings'` (arquivo ainda não existe).

- [ ] **Step 3: Implementar as funções puras**

Criar `lib/embeddings.ts`:
```ts
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/embeddings.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/embeddings.ts tests/embeddings.test.ts
git commit -m "feat: add cosineSimilarity and chunk helpers"
```

---

## Task 3: `embedQuery` e `embedDocuments` (cliente Gemini mockado)

**Files:**
- Modify: `lib/embeddings.ts`
- Test: `tests/embeddings.test.ts`

- [ ] **Step 1: Escrever os testes que falham (com mock do SDK)**

Adicionar ao TOPO de `tests/embeddings.test.ts` (antes dos imports atuais, pois `vi.mock` precisa ser hoisted) e estender o arquivo. Resultado final do arquivo:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbedContent = vi.fn()
const mockBatchEmbedContents = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({
      embedContent: mockEmbedContent,
      batchEmbedContents: mockBatchEmbedContents,
    }),
  })),
  TaskType: {
    RETRIEVAL_QUERY: 'RETRIEVAL_QUERY',
    RETRIEVAL_DOCUMENT: 'RETRIEVAL_DOCUMENT',
  },
}))

import { cosineSimilarity, chunk, embedQuery, embedDocuments } from '../lib/embeddings'

describe('cosineSimilarity', () => {
  it('retorna 1 para vetores idênticos', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1)
  })

  it('retorna 0 para vetores ortogonais', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('retorna -1 para vetores opostos', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('retorna 0 quando algum vetor é nulo (evita divisão por zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('chunk', () => {
  it('fatia em lotes do tamanho pedido', () => {
    const arr = Array.from({ length: 250 }, (_, i) => i)
    const lotes = chunk(arr, 100)
    expect(lotes).toHaveLength(3)
    expect(lotes[0]).toHaveLength(100)
    expect(lotes[1]).toHaveLength(100)
    expect(lotes[2]).toHaveLength(50)
  })

  it('retorna lista vazia para array vazio', () => {
    expect(chunk([], 100)).toEqual([])
  })
})

describe('embedQuery', () => {
  beforeEach(() => {
    mockEmbedContent.mockReset()
  })

  it('retorna o vetor de embedding da pergunta', async () => {
    mockEmbedContent.mockResolvedValue({ embedding: { values: [0.1, 0.2, 0.3] } })
    const vec = await embedQuery('como está a bateria')
    expect(vec).toEqual([0.1, 0.2, 0.3])
    expect(mockEmbedContent).toHaveBeenCalledTimes(1)
  })

  it('propaga o erro quando o Gemini falha (sem fallback)', async () => {
    mockEmbedContent.mockRejectedValue(new Error('429 rate limit'))
    await expect(embedQuery('x')).rejects.toThrow('429 rate limit')
  })
})

describe('embedDocuments', () => {
  beforeEach(() => {
    mockBatchEmbedContents.mockReset()
  })

  it('retorna lista vazia para entrada vazia sem chamar o Gemini', async () => {
    const vecs = await embedDocuments([])
    expect(vecs).toEqual([])
    expect(mockBatchEmbedContents).not.toHaveBeenCalled()
  })

  it('fatia em lotes de 100 e achata os resultados na ordem', async () => {
    const textos = Array.from({ length: 150 }, (_, i) => `c${i}`)
    mockBatchEmbedContents.mockImplementation(async ({ requests }) => ({
      embeddings: requests.map(() => ({ values: [1, 0] })),
    }))

    const vecs = await embedDocuments(textos)

    expect(mockBatchEmbedContents).toHaveBeenCalledTimes(2)
    expect(mockBatchEmbedContents.mock.calls[0][0].requests).toHaveLength(100)
    expect(mockBatchEmbedContents.mock.calls[1][0].requests).toHaveLength(50)
    expect(vecs).toHaveLength(150)
    expect(vecs[0]).toEqual([1, 0])
  })

  it('propaga o erro quando o Gemini falha (sem fallback)', async () => {
    mockBatchEmbedContents.mockRejectedValue(new Error('network'))
    await expect(embedDocuments(['a', 'b'])).rejects.toThrow('network')
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run tests/embeddings.test.ts`
Expected: FAIL — `embedQuery is not a function` / `embedDocuments is not a function`.

- [ ] **Step 3: Implementar `embedQuery` e `embedDocuments`**

Adicionar ao TOPO de `lib/embeddings.ts` (imports e constantes) e as duas funções ao final:
```ts
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai'

const EMBEDDING_MODEL = 'text-embedding-004'
const BATCH_SIZE = 100

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  return genAI.getGenerativeModel({ model: EMBEDDING_MODEL })
}

export async function embedQuery(texto: string): Promise<number[]> {
  const model = getModel()
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text: texto }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  })
  return result.embedding.values
}

export async function embedDocuments(textos: string[]): Promise<number[][]> {
  if (textos.length === 0) return []
  const model = getModel()
  const lotes = chunk(textos, BATCH_SIZE)
  const resultados = await Promise.all(
    lotes.map(lote =>
      model.batchEmbedContents({
        requests: lote.map(text => ({
          content: { role: 'user', parts: [{ text }] },
          taskType: TaskType.RETRIEVAL_DOCUMENT,
        })),
      })
    )
  )
  return resultados.flatMap(r => r.embeddings.map(e => e.values))
}
```
(O `import` vai no topo do arquivo, acima de `cosineSimilarity`; as funções abaixo de `chunk`.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/embeddings.test.ts`
Expected: PASS (12 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/embeddings.ts tests/embeddings.test.ts
git commit -m "feat: add embedQuery and embedDocuments (Gemini)"
```

---

## Task 4: `semanticFilterComments` em `retrieval.ts`

**Files:**
- Modify: `lib/retrieval.ts`
- Test: `tests/retrieval.test.ts`

- [ ] **Step 1: Escrever o teste que falha (mockando `lib/embeddings`)**

Substituir o topo de `tests/retrieval.test.ts` para incluir o mock e o novo import, e adicionar o novo `describe`. O topo do arquivo passa a ser:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEmbedQuery = vi.fn()
const mockEmbedDocuments = vi.fn()

// Mantém as funções puras reais (cosineSimilarity, chunk) e só substitui as
// chamadas de rede. Assim a ordenação é determinística pelos vetores mockados.
vi.mock('../lib/embeddings', async (importActual) => {
  const actual = await importActual<typeof import('../lib/embeddings')>()
  return {
    ...actual,
    embedQuery: mockEmbedQuery,
    embedDocuments: mockEmbedDocuments,
  }
})

import { filterRelevantComments, semanticFilterComments } from '../lib/retrieval'
import type { Comment } from '../types'
```
(Mantenha o `const mockComments` e o `describe('filterRelevantComments', ...)` existentes como estão.)

Adicionar ao final do arquivo:
```ts
describe('semanticFilterComments', () => {
  beforeEach(() => {
    mockEmbedQuery.mockReset()
    mockEmbedDocuments.mockReset()
  })

  const comments: Comment[] = [
    { id: 'a', text: 'igual à query', likeCount: 10 },
    { id: 'b', text: 'ortogonal', likeCount: 10 },
    { id: 'c', text: 'parecido', likeCount: 10 },
  ]

  it('ordena por similaridade de cosseno (maior primeiro)', async () => {
    mockEmbedQuery.mockResolvedValue([1, 0])
    mockEmbedDocuments.mockResolvedValue([
      [1, 0], // a → sim 1
      [0, 1], // b → sim 0
      [0.9, 0.1], // c → sim ~0.99
    ])

    const result = await semanticFilterComments('q', comments, 10)
    expect(result.map(c => c.id)).toEqual(['a', 'c', 'b'])
  })

  it('respeita topN', async () => {
    mockEmbedQuery.mockResolvedValue([1, 0])
    mockEmbedDocuments.mockResolvedValue([[1, 0], [0, 1], [0.9, 0.1]])
    const result = await semanticFilterComments('q', comments, 2)
    expect(result).toHaveLength(2)
  })

  it('retorna vazio quando não há comentários (sem chamar embeddings)', async () => {
    const result = await semanticFilterComments('q', [], 10)
    expect(result).toEqual([])
    expect(mockEmbedQuery).not.toHaveBeenCalled()
  })

  it('propaga o erro quando o Gemini falha (erro explícito, sem fallback)', async () => {
    mockEmbedQuery.mockRejectedValue(new Error('429'))
    mockEmbedDocuments.mockResolvedValue([[1, 0], [0, 1], [0.9, 0.1]])
    await expect(semanticFilterComments('q', comments, 10)).rejects.toThrow('429')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/retrieval.test.ts`
Expected: FAIL — `semanticFilterComments is not a function`.

- [ ] **Step 3: Implementar `semanticFilterComments`**

Em `lib/retrieval.ts`, ajustar o import do topo e adicionar a função ao final.

Topo (substituir a linha de import atual):
```ts
import type { Comment } from '../types'
import { embedQuery, embedDocuments, cosineSimilarity } from './embeddings'
```

Ao final do arquivo:
```ts
export async function semanticFilterComments(
  pergunta: string,
  comentarios: Comment[],
  topN: number = 30
): Promise<Comment[]> {
  if (comentarios.length === 0) return []

  const [queryVec, docVecs] = await Promise.all([
    embedQuery(pergunta),
    embedDocuments(comentarios.map(c => c.text)),
  ])

  const scored = comentarios.map((comment, i) => ({
    comment,
    score: cosineSimilarity(queryVec, docVecs[i]),
  }))

  return scored
    .sort((a, b) => b.score - a.score || b.comment.likeCount - a.comment.likeCount)
    .slice(0, topN)
    .map(s => s.comment)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/retrieval.test.ts`
Expected: PASS (testes antigos de keyword + 4 novos).

- [ ] **Step 5: Commit**

```bash
git add lib/retrieval.ts tests/retrieval.test.ts
git commit -m "feat: add semanticFilterComments (cosine over Gemini embeddings)"
```

---

## Task 5: Dispatcher `selectRelevantComments`

**Files:**
- Modify: `lib/retrieval.ts`
- Test: `tests/retrieval.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Atualizar o import em `tests/retrieval.test.ts` para incluir o dispatcher:
```ts
import {
  filterRelevantComments,
  semanticFilterComments,
  selectRelevantComments,
} from '../lib/retrieval'
```

Adicionar ao final do arquivo:
```ts
describe('selectRelevantComments (dispatcher)', () => {
  beforeEach(() => {
    mockEmbedQuery.mockReset()
    mockEmbedDocuments.mockReset()
  })

  const comments: Comment[] = [
    { id: '1', text: 'A bateria dura o dia todo', likeCount: 100 },
    { id: '2', text: 'Tela muito bonita', likeCount: 50 },
  ]

  it('roteia para keyword sem tocar nos embeddings', async () => {
    const result = await selectRelevantComments('keyword', 'bateria', comments, 10)
    expect(result.map(c => c.id)).toContain('1')
    expect(mockEmbedQuery).not.toHaveBeenCalled()
    expect(mockEmbedDocuments).not.toHaveBeenCalled()
  })

  it('roteia para semantic usando os embeddings', async () => {
    mockEmbedQuery.mockResolvedValue([1, 0])
    mockEmbedDocuments.mockResolvedValue([[0, 1], [1, 0]])
    const result = await selectRelevantComments('semantic', 'q', comments, 10)
    expect(result.map(c => c.id)).toEqual(['2', '1'])
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/retrieval.test.ts`
Expected: FAIL — `selectRelevantComments is not a function`.

- [ ] **Step 3: Implementar o dispatcher**

Em `lib/retrieval.ts`, adicionar ao final:
```ts
export type RetrievalMethod = 'keyword' | 'semantic'

export async function selectRelevantComments(
  method: RetrievalMethod,
  pergunta: string,
  comentarios: Comment[],
  topN: number = 30
): Promise<Comment[]> {
  if (method === 'semantic') {
    return semanticFilterComments(pergunta, comentarios, topN)
  }
  return filterRelevantComments(pergunta, comentarios, topN)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/retrieval.test.ts`
Expected: PASS (todos os testes de retrieval).

- [ ] **Step 5: Commit**

```bash
git add lib/retrieval.ts tests/retrieval.test.ts
git commit -m "feat: add selectRelevantComments dispatcher (keyword|semantic)"
```

---

## Task 6: Ligar tudo em `api/ask.ts`

Lê o `method` (default `keyword`), chama o dispatcher e devolve **502 explícito** se o Gemini falhar no caminho semântico. O caminho keyword continua síncrono e idêntico ao de hoje.

**Files:**
- Modify: `api/ask.ts:1-4` (imports) e `api/ask.ts:39-43` (corpo do handler)

- [ ] **Step 1: Atualizar o import do retrieval**

Em `api/ask.ts`, substituir:
```ts
import { filterRelevantComments } from '../lib/retrieval'
```
por:
```ts
import { selectRelevantComments } from '../lib/retrieval'
```

- [ ] **Step 2: Atualizar o corpo do handler**

Substituir o trecho (atualmente `api/ask.ts:39-43`):
```ts
  const sanitized = body.pergunta.slice(0, 500) // previne prompt injection por tamanho
  const relevantes = filterRelevantComments(sanitized, body.comentarios, 30)
  const resultado = await askGroq(sanitized, relevantes)

  return res.status(200).json(resultado)
```
por:
```ts
  const sanitized = body.pergunta.slice(0, 500) // previne prompt injection por tamanho
  const method = body.method === 'semantic' ? 'semantic' : 'keyword' // default: keyword

  let relevantes
  try {
    relevantes = await selectRelevantComments(method, sanitized, body.comentarios, 30)
  } catch (error) {
    // Caminho semântico: falha do Gemini vira erro explícito (sem fallback para keyword)
    return res.status(502).json({ error: 'Falha ao gerar embeddings (busca semântica)' })
  }

  const resultado = await askGroq(sanitized, relevantes)

  return res.status(200).json(resultado)
```

- [ ] **Step 3: Verificar tipos e rodar toda a suíte**

Run: `npm run lint`
Expected: PASS.

Run: `npm test`
Expected: PASS — toda a suíte (embeddings + retrieval + llm) verde.

- [ ] **Step 4: Smoke test manual do default keyword (sem chave Gemini necessária)**

Run: `npm run dev` em um terminal e, em outro:
```bash
curl -s -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -d '{"pergunta":"como está a bateria","comentarios":[{"id":"1","text":"a bateria dura muito","likeCount":5}]}'
```
Expected: HTTP 200 com `{ resposta, comentarios_fonte }` (caminho keyword, comportamento igual ao de hoje, pois `method` foi omitido).

> Nota: o smoke test do caminho `method:"semantic"` exige `GEMINI_API_KEY` válida no `.env` e é opcional aqui — a lógica já está coberta por testes determinísticos com mock.

- [ ] **Step 5: Commit**

```bash
git add api/ask.ts
git commit -m "feat: wire method dispatcher into /api/ask with explicit 502 on Gemini failure"
```

---

## Verificação final (após todas as tasks)

- [ ] `npm test` → toda a suíte verde.
- [ ] `npm run lint` → sem erros de tipo.
- [ ] Conferir que `filterRelevantComments` não mudou de comportamento (testes de keyword originais continuam passando).
- [ ] Conferir que o caminho semântico **não** tem fallback silencioso (testes de propagação de erro + 502 no handler).
- [ ] Atualizar a memória `busca-semantica-embeddings-wip` para refletir conclusão da implementação.
