# YouTube Comment Analysis — Backend

API serverless (Vercel) que dá suporte à extensão **CommentLens** (`youtube-comment-extension`, repositório irmão). Faz duas coisas:

1. **Coleta** os comentários de um vídeo do YouTube (`GET /api/comments`) — a chave da YouTube Data API fica só aqui, nunca na extensão.
2. **Responde perguntas** sobre esses comentários (`POST /api/ask`) — filtra os mais relevantes (RAG, por palavra-chave ou por embeddings) e gera a resposta com um LLM da Groq.

Cada interação é persistida no Neon (Postgres) para servir de **base de pesquisa do TCC** — a comparação entre busca por palavra-chave e busca semântica.

> **Ambiente atual:** o backend roda **em produção na Vercel**; a extensão continua sendo carregada localmente no Chrome (modo desenvolvedor). Ver [Deploy em produção](#deploy-em-produção).

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js (≥18) + TypeScript |
| Deploy | Vercel (Serverless Functions, `@vercel/node`) |
| LLM | Groq — `llama-3.3-70b-versatile` (fallback: `mixtral-8x7b-32768`) |
| Embeddings | Google Gemini — `gemini-embedding-001` |
| Comentários | YouTube Data API v3 (`/commentThreads`) |
| Banco | Neon (Postgres serverless) + Drizzle ORM |
| Testes | Vitest (51 testes) |

---

## Estrutura do projeto

```
├── api/
│   ├── ask.ts              # POST /api/ask      — pergunta + comentários → resposta da IA
│   └── comments.ts         # GET  /api/comments — coleta comentários do YouTube
├── lib/
│   ├── cors.ts             # CORS compartilhado pelos dois endpoints
│   ├── retrieval.ts        # Filtro de relevância: keyword, semantic e o dispatcher
│   ├── embeddings.ts       # Embeddings Gemini + similaridade de cosseno
│   ├── youtube.ts          # Paginação da YouTube Data API
│   ├── llm.ts              # Prompt, chamada à Groq e parser da resposta
│   ├── db.ts               # Client Neon HTTP + Drizzle (getDb)
│   └── persistence.ts      # montarLinhas (pura) + salvarInteracao (única escrita)
├── db/
│   └── schema.ts           # Schema Drizzle: interacoes, interacao_comentarios
├── scripts/
│   └── dev-server.ts       # Servidor local que imita a Vercel (sem `vercel dev`)
├── tests/                  # Vitest: ask, retrieval, embeddings, youtube, llm, persistence
├── docs/                   # Documentação de apoio do TCC
├── types.ts                # Interfaces TypeScript compartilhadas
├── drizzle.config.ts
├── vercel.json             # Builds e rotas das funções
└── package.json
```

---

## Endpoints

### `GET /api/comments?videoId=<id>`

Busca os comentários de um vídeo na YouTube Data API e devolve tudo de uma vez. A paginação acontece no servidor: 100 comentários por página, no máximo **5 páginas / 500 comentários**, ordenados por relevância, com 100 ms de intervalo entre páginas.

#### Response `200 OK`

```json
{
  "comments": [
    {
      "id": "Ugx...",
      "author": "Fulano",
      "text": "A bateria dura o dia todo",
      "textOriginal": "A bateria dura o dia todo",
      "likeCount": 120,
      "publishedAt": "2026-01-02T10:00:00Z",
      "updatedAt": "2026-01-02T10:00:00Z"
    }
  ],
  "totalComments": 347,
  "pagesCollected": 4,
  "limitReached": false
}
```

| Status | Situação |
|---|---|
| `400` | `videoId` ausente |
| `405` | Método diferente de GET |
| `502` | Falha na YouTube Data API (quota, vídeo com comentários desativados, id inválido) |

---

### `POST /api/ask`

Recebe uma pergunta e a lista de comentários, retorna a resposta da IA com os comentários que a embasaram.

#### Request

```json
{
  "pergunta": "Como está a bateria desse celular?",
  "comentarios": [
    { "id": "1", "text": "A bateria dura o dia todo, muito boa", "likeCount": 120 },
    { "id": "2", "text": "Tela linda e brilhante", "likeCount": 45 },
    { "id": "3", "text": "Bateria melhorou bastante nessa versão", "likeCount": 80 }
  ],
  "method": "keyword",
  "compare": false,
  "videoId": "dQw4w9WgXcQ"
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `pergunta` | `string` | ✅ | Pergunta do usuário (truncada em 500 caracteres) |
| `comentarios` | `Comment[]` | ✅ | Lista de comentários (não pode estar vazia) |
| `method` | `'keyword' \| 'semantic'` | — | Estratégia de recuperação. Padrão: `keyword`. Ignorado quando `compare: true` |
| `compare` | `boolean` | — | Roda **os dois métodos** para a mesma pergunta e grava o par no banco. Padrão: `false` |
| `videoId` | `string` | — | Só para a persistência; não afeta a resposta |

**Tipo `Comment`:** `{ id: string, text: string, likeCount: number }`

#### Response `200 OK`

```json
{
  "resposta": "A bateria é bem avaliada pelos usuários, com relatos de que dura o dia todo.",
  "comentarios_fonte": [
    { "id": "1", "text": "A bateria dura o dia todo, muito boa", "likeCount": 120 },
    { "id": "3", "text": "Bateria melhorou bastante nessa versão", "likeCount": 80 }
  ]
}
```

Em modo `compare`, a resposta devolvida ao usuário é a do método **semântico**. Se só o keyword tiver sucesso, a resposta vem com um campo extra `aviso` explicando a degradação.

#### Respostas de erro

| Status | Situação |
|---|---|
| `400` | `pergunta` ausente/vazia ou `comentarios` vazio/ausente |
| `405` | Método diferente de POST |
| `502` | Falha ao gerar embeddings (`method: 'semantic'`) ou, em `compare`, falha dos dois métodos |

---

## Modo de comparação (`compare: true`)

**A extensão envia `compare: true` em toda pergunta.** Isso significa que, por pergunta:

- os dois métodos rodam em paralelo (`Promise.allSettled`) sobre exatamente a mesma entrada;
- as duas interações são gravadas no banco compartilhando um `par_id`, o que permite comparar keyword × semântico com experimento controlado;
- o usuário vê a resposta semântica (ou a de keyword, com `aviso`, se o Gemini falhar).

Consequência prática: **`GEMINI_API_KEY` é obrigatória em produção**, mesmo que a busca semântica seja conceitualmente "opcional". Ver `docs/comparacao-keyword-vs-semantica.md`.

---

## Como funciona internamente

### 1. CORS (`lib/cors.ts`)

Compartilhado pelos dois endpoints. `Access-Control-Allow-Origin` só é devolvido para:

- extensões Chrome: origens `chrome-extension://*`
- desenvolvimento local: exatamente `http://localhost`

Requisições `OPTIONS` (preflight) são respondidas com `204 No Content`. Qualquer outra origem não recebe os headers e é bloqueada pelo navegador — **não ampliar esse escopo**.

### 2. Seleção de comentários (`lib/retrieval.ts`)

Antes de chamar o LLM, no máximo **30 comentários** são selecionados, por um de dois caminhos:

**`keyword` (padrão)** — puramente léxico, síncrono e sem dependências externas:

1. A pergunta é tokenizada: palavras com mais de 3 letras viram keywords.
2. Cada comentário recebe um score = número de ocorrências das keywords.
3. Ordena por score (empate desfeito por likes) e devolve os `topN`.
4. **Fallback:** sem keywords úteis ou sem nenhum match, devolve os `topN` com mais likes.

> Caracteres especiais de regex nas keywords (`(`, `)`, `.`, `*`…) são escapados para evitar `SyntaxError` no `RegExp`.

**`semantic`** — baseado em significado (`lib/embeddings.ts`):

1. `embedQuery` vetoriza a pergunta (`RETRIEVAL_QUERY`).
2. `embedDocuments` vetoriza os comentários em lotes de 100 (`RETRIEVAL_DOCUMENT`).
3. Ranqueia por similaridade de cosseno (empate por likes) e devolve os `topN`.

Se o Gemini falhar, o endpoint responde **`502` explícito** — não existe fallback silencioso para keyword, justamente para não contaminar os dados do experimento.

### 3. Geração da resposta (`lib/llm.ts`)

O prompt posiciona o modelo como assistente que analisa comentários, lista os comentários numerados com seus likes e instrui a tratá-los **apenas como dados** (ignorando instruções embutidas neles — mitigação de prompt injection). Pede resposta em português (2–4 frases) terminando em `FONTES: [1, 3, 7]`.

| Modelo | Papel |
|---|---|
| `llama-3.3-70b-versatile` | Primário |
| `mixtral-8x7b-32768` | Fallback automático em HTTP `429` (rate limit) |

Parâmetros fixos: `temperature: 0.3`, `max_tokens: 1024`. O modelo que de fato respondeu é devolvido em `modelo` e gravado no banco.

### 4. Parse da resposta (`parseResponse`)

- Separa o texto da linha `FONTES: [...]` (a linha é removida do texto exibido).
- Converte os índices 1-based em 0-based e descarta os fora do intervalo.
- Devolve também `indicesFonte`, usado pela persistência para marcar `foi_fonte`.

---

## Persistência (base de pesquisa)

Cada chamada a `/api/ask` grava no Neon uma linha em `interacoes` e até 30 em `interacao_comentarios`. Os comentários-fonte não são linhas próprias: são as linhas com `foi_fonte = true`.

| Tabela | Conteúdo |
|---|---|
| `interacoes` | pergunta, resposta, `metodo`, `modelo_llm`, `video_id`, `par_id`, `total_comentarios_recebidos`, `latencia_filtro_ms`, `criado_em` |
| `interacao_comentarios` | os 30 comentários filtrados, com `posicao` (ranking 1-based) e `foi_fonte` |

Detalhes de implementação que valem lembrar:

- A gravação é **best-effort**: falha no Neon é apenas logada, a resposta HTTP continua `200`.
- O driver `neon-http` **não suporta** `db.transaction()`. A atomicidade vem de `db.batch([...])` — por isso `interacoes.id` é um UUID gerado na aplicação, e não `BIGSERIAL`.
- O enum de `metodo` no Drizzle só existe em tempo de compilação; a garantia real é a constraint `ck_int_metodo` no banco.

Documentação completa: `docs/persistencia-interacoes.md`.

---

## Variáveis de ambiente

| Variável | Obrigatória | Usada por | Descrição |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ | `lib/llm.ts` | Chave da [Groq](https://console.groq.com/) |
| `GEMINI_API_KEY` | ✅ | `lib/embeddings.ts` | Chave do [Google AI Studio](https://aistudio.google.com/apikey) — busca semântica. Obrigatória na prática porque a extensão usa `compare: true` |
| `YOUTUBE_API_KEY` | ✅ | `lib/youtube.ts` | Chave da YouTube Data API v3 ([Google Cloud Console](https://console.cloud.google.com/)) |
| `DATABASE_URL` | ⚠️ | `lib/db.ts` | Postgres do Neon. Sem ela a API continua respondendo, mas **nada é persistido** |

Local: copie `.env.example` para `.env` (gitignored) e preencha. Produção: Vercel → Project → Settings → Environment Variables.

---

## Rodando localmente

```bash
npm install
cp .env.example .env     # preencha as chaves

npm run dev:local        # servidor local (shim da Vercel) — não exige login na Vercel
# ou
npm run dev:vercel       # `vercel dev` — mais fiel ao ambiente serverless, exige login + rede
```

Endpoints em `http://localhost:3000/api/ask` e `http://localhost:3000/api/comments`.

`scripts/dev-server.ts` (usado por `dev:local`) é um servidor HTTP mínimo que roteia por pathname, faz parse do body JSON e injeta os helpers `res.status()` / `res.json()` esperados pelos handlers da Vercel.

### Teste rápido do endpoint (PowerShell)

```powershell
$body = '{"pergunta":"A bateria e boa?","comentarios":[{"id":"1","text":"Bateria dura o dia todo","likeCount":50}]}'
Invoke-RestMethod -Uri "http://localhost:3000/api/ask" -Method Post -ContentType "application/json" -Body $body

Invoke-RestMethod -Uri "http://localhost:3000/api/comments?videoId=dQw4w9WgXcQ"
```

---

## Banco de dados (Drizzle + Neon)

```bash
npm run db:generate   # gera a migration SQL (pasta drizzle/) a partir de db/schema.ts
npm run db:migrate    # aplica as migrations no banco (precisa de DATABASE_URL)
npm run db:studio     # Drizzle Studio: navega nos dados persistidos
```

`db/schema.ts` é a fonte da verdade do schema e dos tipos — nunca alterar as tabelas direto no Neon sem refletir no schema.

> A pasta `drizzle/` ainda não existe no repositório: as migrations são geradas por `db:generate` na primeira vez que o banco for provisionado.

---

## Testes

```bash
npm test               # todos os testes uma vez (vitest run)
npm run test:watch     # modo watch
npm run test:coverage  # com cobertura
npm run lint           # tsc --noEmit
```

Um arquivo só: `npx vitest run tests/retrieval.test.ts`

### Cobertura atual — 51 testes em 6 arquivos

| Arquivo | O que cobre |
|---|---|
| `ask.test.ts` | Validação de input, seleção de método, modo `compare`, comportamento best-effort da persistência |
| `retrieval.test.ts` | Filtro por keyword, fallback por likes, `topN`, filtro semântico e o dispatcher `selectRelevantComments` |
| `embeddings.test.ts` | `cosineSimilarity`, `chunk`, `embedQuery`/`embedDocuments` com o cliente Gemini mockado |
| `youtube.test.ts` | Paginação, limites `MAX_PAGES`/`MAX_COMMENTS`, erro explícito em falha da API |
| `llm.test.ts` | Parsing do formato `FONTES: [...]`, índices fora de range, remoção da linha do texto |
| `persistence.test.ts` | `montarLinhas` (posições, `foi_fonte`) e `salvarInteracao` via `db.batch` |

Os testes não fazem rede: Groq, Gemini, YouTube e Neon são mockados.

---

## Deploy em produção

O backend é a **única parte hospedada**. A extensão continua rodando localmente no Chrome e aponta para a URL de produção.

### 1. Publicar

```bash
npm install -g vercel     # se ainda não tiver
vercel login
vercel link               # associa esta pasta a um projeto Vercel
vercel --prod             # deploy de produção
```

### 2. Configurar as variáveis de ambiente

No dashboard (Project → Settings → Environment Variables), ambiente **Production**:

- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `YOUTUBE_API_KEY`
- `DATABASE_URL` (connection string do Neon, com `?sslmode=require`)

Ou pela CLI:

```bash
vercel env add GROQ_API_KEY production
vercel env add GEMINI_API_KEY production
vercel env add YOUTUBE_API_KEY production
vercel env add DATABASE_URL production
```

> Variáveis novas só valem para deploys novos — rode `vercel --prod` de novo depois de adicioná-las.

### 3. Aplicar as migrations no Neon

```bash
npm run db:migrate     # com DATABASE_URL apontando para o banco de produção
```

### 4. Apontar a extensão para a produção

No repositório irmão `youtube-comment-extension`, edite `config.js`:

```javascript
export const BACKEND_URL = 'https://seu-projeto.vercel.app';
```

e recarregue a extensão em `chrome://extensions/`. O `manifest.json` já declara `host_permissions` para `https://*.vercel.app/*`.

### 5. Verificar

```powershell
$body = '{"pergunta":"funciona?","comentarios":[{"id":"1","text":"funciona sim","likeCount":1}]}'
Invoke-RestMethod -Uri "https://seu-projeto.vercel.app/api/ask" -Method Post -ContentType "application/json" -Body $body
```

Chamada sem header `Origin` continua funcionando (CORS é imposto pelo navegador, não pelo servidor) — serve como smoke test. Para validar o fluxo real, use a extensão.

### Notas sobre a URL

Cada deploy gera uma URL única, mas o **domínio de produção do projeto** (`https://<projeto>.vercel.app`) sempre aponta para o deploy promovido — é essa a URL que deve ficar em `config.js`. Assim não é preciso mexer na extensão a cada novo deploy.

### Configuração das funções (`vercel.json`)

Ambas as funções (`api/ask.ts` e `api/comments.ts`) usam:

- **Builder:** `@vercel/node` (TypeScript nativo)
- **Memória:** 256 MB
- **Timeout máximo:** 30 segundos

O timeout de 30 s importa: com `compare: true` a requisição faz embeddings de até 500 comentários **mais** duas chamadas ao LLM.

---

## Documentação de apoio (TCC)

| Documento | Conteúdo |
|---|---|
| `docs/comparacao-keyword-vs-semantica.md` | Fundamentação da comparação entre os dois métodos de recuperação |
| `docs/persistencia-interacoes.md` | O que é gravado por interação e como consultar |
| `docs/superpowers/specs/` | Decisões de projeto (busca semântica, persistência, coleta pareada) |
