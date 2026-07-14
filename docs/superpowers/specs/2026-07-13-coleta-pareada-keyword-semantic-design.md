# Design — Coleta pareada keyword vs semantic

**Data:** 2026-07-13
**Subprojeto:** A (Coleta pareada) — parte 1 de 2 do trabalho de avaliação do TCC.
O Subprojeto B (tooling de análise) terá spec própria depois, e depende de já existir
dado coletado por este.

## Problema

O backend já suporta os dois métodos de recuperação de comentários relevantes —
`keyword` e `semantic` (embeddings Gemini) — selecionáveis via `method` no body de
`POST /api/ask`. A persistência das interações no Neon também já existe e grava
`metodo`, `latencia_filtro_ms`, os 30 comentários filtrados (com `posicao` e `foi_fonte`),
etc.

Porém a extensão **nunca envia `method`**: o payload de `callLLM` em
`service-worker.js` monta só `{ pergunta, comentarios, videoId }`, então `/api/ask`
sempre cai no default `keyword`. Consequência: 100% das linhas gravadas teriam
`metodo = 'keyword'`, e a comparação keyword vs semantic — objetivo central da base de
pesquisa pedida pelo orientador — fica **impossível de montar com dados reais**.

## Objetivo

Para cada pergunta real, rodar **os dois métodos sobre os mesmos comentários** e gravar
**duas linhas linkadas** (dataset pareado). Isso permite comparar keyword vs semantic
sobre entradas idênticas — o design mais forte para a análise estatística do capítulo de
avaliação.

Não-objetivos (fora de escopo, specs próprias depois):
- Tooling de análise / leitura do Neon para gerar métricas (Subprojeto B).
- Deploy na Vercel (`DATABASE_URL` + `YOUTUBE_API_KEY` em produção).
- Mostrar as duas respostas lado a lado na UI da extensão.

## Decisões de design

Tomadas em brainstorming (2026-07-13):

1. **Onde roda:** no backend, numa requisição só. O `/api/ask` ganha um flag `compare`
   que roda os dois métodos sobre os mesmos comentários e grava o par. Garante input
   idêntico e mantém a extensão quase intacta (1 round-trip).
2. **O que a UI mostra:** uma resposta só — a do método **semantic** (a abordagem nova a
   validar). As duas linhas são gravadas de qualquer forma. UI fica intacta.
3. **Falha parcial:** best-effort — grava a(s) linha(s) que tiveram sucesso mesmo que a
   outra falhe. A coleta nunca trava. A análise pareada (Subprojeto B) descarta os
   meio-pares órfãos.
4. **Linkagem do par:** coluna nova `par_id` (uuid) compartilhada pelas duas linhas.
5. **Latência:** os dois métodos rodam em paralelo (`Promise.allSettled`), para não
   dobrar o tempo de parede.
6. **Retrocompatibilidade:** `compare` default `false`. Sem o flag, `/api/ask` se comporta
   exatamente como hoje (um método via `method`).

## Arquitetura

```
extensão (service-worker.js)
   │  POST /api/ask  { pergunta, comentarios, videoId, compare: true }
   ▼
/api/ask  (compare === true)
   │  parId = randomUUID()
   ├── keyword:  selectRelevantComments('keyword', …)  → askGroq   ┐ Promise.allSettled
   └── semantic: selectRelevantComments('semantic', …) → askGroq   ┘ (paralelo)
   │
   ├── persiste cada método que teve sucesso  → salvarInteracao(parId)   (best-effort)
   │
   └── resposta p/ UI: semantic  (fallback keyword se semantic falhou; 502 se ambos falharem)
```

## Componentes e mudanças

### 1. Schema — `db/schema.ts` + migração

Adicionar em `interacoes`:
- Coluna `par_id uuid` (nullable). Duas linhas de uma comparação compartilham o mesmo
  valor; linhas single-method (legadas ou `compare` desligado) ficam `null`.
- Índice `idx_int_par` sobre `par_id`.

A migração é aditiva e não quebra dados existentes. Gerar com `npm run db:generate` e
aplicar com `npm run db:migrate`.

### 2. Persistência — `lib/persistence.ts`

- `InteracaoParaSalvar` ganha `parId?: string | null`.
- `montarLinhas` passa `parId` para a linha de `interacoes` (default `null` quando ausente).
- `salvarInteracao` permanece igual: cada chamada gera seu próprio `id`; o `parId` é o que
  liga as duas linhas. Para gravar um par, `/api/ask` chama `salvarInteracao` duas vezes
  com o mesmo `parId`.

### 3. Backend — `api/ask.ts` + `types.ts`

- `AskRequest` ganha `compare?: boolean`.
- **`compare !== true`** → caminho atual **intacto** (um método via `method`, uma linha).
- **`compare === true`**:
  1. `parId = randomUUID()`.
  2. Para cada método em `['keyword', 'semantic']`, em paralelo via `Promise.allSettled`:
     - cronometrar `selectRelevantComments(metodo, sanitized, comentarios, 30)` →
       `latenciaFiltroMs`;
     - `askGroq(sanitized, relevantes)`.
  3. Para cada método que resolveu, chamar `salvarInteracao(getDb(), { …, metodo, parId })`
     dentro do mesmo `try/catch` best-effort de hoje (persistência nunca derruba a resposta).
  4. Montar a resposta HTTP:
     - semantic resolveu → `{ resposta, comentarios_fonte }` do semantic;
     - semantic falhou mas keyword resolveu → resposta do keyword + `aviso` indicando o
       fallback;
     - ambos falharam → `502 { error }`.

O caminho não-compare continua retornando `502` se o método (semantic) escolhido falhar,
como hoje.

### 4. Extensão — `service-worker.js`

Único ponto: adicionar `compare: true` ao payload de `callLLM` (hoje em
`service-worker.js:47`). A UI (`popup.js`) segue renderizando `response.resposta` +
`comentarios_fonte` sem mudança — agora serão os do semantic. Se `/api/ask` devolver
`aviso` (fallback pro keyword), o service-worker pode repassá-lo, mas exibir o aviso na UI
é opcional e não bloqueia a coleta.

## Fluxo de dados (compare === true, caminho feliz)

1. Extensão coleta comentários (`/api/comments`) e envia pergunta com `compare: true`.
2. Backend gera `parId`, roda os dois métodos em paralelo sobre os mesmos comentários.
3. Grava duas linhas em `interacoes` (mesmo `par_id`, `metodo` distinto) + suas linhas em
   `interacao_comentarios`.
4. Devolve a resposta do semantic à extensão; UI renderiza normalmente.

## Tratamento de erro

| Cenário | Persiste | Resposta HTTP |
|---|---|---|
| keyword ✅ · semantic ✅ | as 2 linhas (par completo) | 200, resposta do semantic |
| keyword ✅ · semantic ❌ | só keyword | 200, resposta do keyword + `aviso` |
| keyword ❌ · semantic ✅ | só semantic | 200, resposta do semantic |
| keyword ❌ · semantic ❌ | nada | 502 |

Persistência é best-effort: uma falha ao gravar no Neon é logada e **não** afeta a resposta
ao usuário (comportamento atual mantido).

## Testes

Unit (Vitest, backend), com mocks de `retrieval`, `llm` e `persistence`:
- `compare: true`, ambos ok → `salvarInteracao` chamado 2x com o **mesmo** `parId` e
  `metodo` distinto; resposta HTTP é a do semantic.
- `compare: true`, semantic falha → `salvarInteracao` chamado 1x (keyword); HTTP 200 com
  resposta do keyword + `aviso`.
- `compare: true`, keyword falha → 1x (semantic); HTTP 200 com resposta do semantic.
- `compare: true`, ambos falham → `salvarInteracao` não chamado; HTTP 502.
- `compare` ausente/`false` → comportamento atual inalterado (1 método, 1 linha).
- `montarLinhas` grava `par_id` quando presente e `null` quando ausente.

Verificação manual (após implementar): migração aplicada localmente + uma pergunta real
ponta a ponta gerando um par no Neon (fecha o teste ponta-a-ponta que nunca rodou com dado
real).

## Impacto e riscos

- **Custo/latência:** modo compare faz 2x chamadas de LLM (e o caminho semantic ainda chama
  o Gemini para embeddings) por pergunta. Aceito: é ferramenta de coleta de pesquisa,
  usada pelo autor. Paralelismo mitiga a latência de parede.
- **Meio-pares órfãos:** best-effort pode gerar linhas sem par. A análise (Subprojeto B)
  filtra por `par_id` com contagem 2 antes de comparar.
- **Migração:** aditiva e nullable — sem risco para dados existentes.
