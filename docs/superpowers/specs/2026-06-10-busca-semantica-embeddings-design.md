# Design: Busca semântica com embeddings (Gemini)

**Data:** 2026-06-10 (decisões finais 2026-06-11)
**Status:** 🟢 Design aprovado — pendências resolvidas, pronto para `writing-plans`
**Projeto:** youtube-comment-backend

---

## Estado atual (onde paramos)

Design completo, arquitetura aprovada e as 2 decisões pendentes resolvidas em
2026-06-11 (ver "Decisões tomadas"). Próximo passo: invocar a skill `writing-plans`
para gerar o plano de implementação.

Também confirmado em 2026-06-11: a escolha do método **fica só no backend** (campo
`method` no request). A extensão **não** ganha toggle na UI — o usuário final só
digita a pergunta; o campo `method` serve para os experimentos de comparação do TCC.

---

## Contexto e motivação

Hoje a seleção dos 30 comentários mais relevantes (`lib/retrieval.ts`,
`filterRelevantComments`) usa **keyword matching**: extrai palavras > 3 letras da
pergunta, conta ocorrências em cada comentário, ordena por score (empate por
`likeCount`) e pega top 30. Cai em "ordenar por likes" quando a pergunta não tem
keywords úteis ou nenhum comentário dá match.

Limitações: não captura sinônimos ("som" vs "áudio"), variações morfológicas
("editar" vs "edição"), acentuação/erros de digitação, nem contexto semântico.

**Objetivo (decidido):** evoluir para busca semântica com embeddings, **mantendo a
busca por keyword lado a lado** para comparar os dois métodos (capítulo de avaliação
do TCC).

## Decisões tomadas

| Tema | Decisão |
|------|---------|
| Objetivo | Comparar os dois métodos (keyword vs semântico) lado a lado |
| Volume | A extensão envia até **500 comentários** por requisição |
| Provider de embeddings | **Google Gemini `text-embedding-004`** (gratuito, sem cartão, bom multilíngue). Groq não oferece embeddings. |
| Restrição | Solução precisa ser **gratuita** |
| Escopo | **Só habilitar os dois métodos** no backend (`method: keyword \| semantic`). Sem tooling de avaliação, sem toggle na UI da extensão. |
| Default do `method` (decidido 2026-06-11) | **`keyword`** quando ausente → extensão atual continua idêntica; semântico só roda sob pedido explícito. |
| Falha do Gemini (decidido 2026-06-11) | **Erro explícito** (sem fallback silencioso) → resultados limpos para a comparação do TCC; falhas ficam visíveis. |

## Arquitetura e componentes

Preserva o que existe e adiciona em paralelo, com fronteiras limpas:

- **`lib/embeddings.ts`** (novo) — parte de vetores, isolada:
  - `embedQuery(texto)` → vetor da pergunta (`task_type: RETRIEVAL_QUERY`)
  - `embedDocuments(textos[])` → vetores dos comentários, fatiando em **lotes de 100**
    (limite do `batchEmbedContents`) e disparando em paralelo (`Promise.all`),
    `task_type: RETRIEVAL_DOCUMENT`
  - `cosineSimilarity(a, b)` → número
  - Cliente Gemini via `@google/generative-ai`, chave em `GEMINI_API_KEY`
- **`lib/retrieval.ts`** (editado) — mantém `filterRelevantComments` (keyword) intacto e ganha:
  - `semanticFilterComments(pergunta, comentarios, topN)` → embedda, calcula cosseno,
    ordena desc (empate por `likeCount`), pega top N
  - `selectRelevantComments(method, ...)` → dispatcher keyword vs semantic
- **`api/ask.ts`** (editado) — lê `method` do request e chama o dispatcher
- **`types.ts`** (editado) — `AskRequest.method?: "keyword" | "semantic"`

## Fluxo de dados

```
POST /api/ask { pergunta, comentarios[500], method? }
  → method ?? "keyword"   (default decidido)
  → keyword:  filterRelevantComments  (síncrono, igual hoje)
  → semantic: embedQuery + embedDocuments(5 lotes ‖) → cosine → top 30
              (se Gemini falhar → erro explícito, sem fallback)
  → askGroq(pergunta, top30)  → { resposta, comentarios_fonte }
```

O resto do pipeline (Groq, parsing de `FONTES:`) não muda.

## Tratamento de erros

- Caminho semântico: se o Gemini falhar (rate limit 429, rede, chave inválida),
  **erro explícito** (ex.: HTTP 502 com mensagem clara) — **sem** fallback silencioso
  para keyword, para não contaminar a comparação dos métodos no TCC.
- Comentários vazios → `[]` (igual hoje).

## Testes (Vitest)

- `embeddings.test.ts`: cosseno (casos conhecidos), lógica de lotes (fatiamento em 100).
  Cliente Gemini **mockado** — sem chamada real.
- `retrieval.test.ts` (estende): `semanticFilterComments` ordena por similaridade;
  dispatcher roteia certo; fallback para keyword quando embeddings lançam erro.
  Determinístico com mock.

## Infra

- Nova dependência: `@google/generative-ai`.
- `GEMINI_API_KEY` no `.env` / Vercel env.
- Memória/timeout do Vercel **não mudam** (256MB/30s bastam — sem modelo local;
  ~6 chamadas HTTP rápidas).

## Notas técnicas do Gemini

- `text-embedding-004`: `batchEmbedContents` aceita até **100 itens por chamada**
  → 500 comentários = 5 lotes (paralelizar com `Promise.all`).
- `task_type` distinto para query (`RETRIEVAL_QUERY`) e documentos
  (`RETRIEVAL_DOCUMENT`) melhora a recuperação.
- Tier gratuito tem rate limit (~100 RPM / ~1500 RPD) — suficiente para uso normal;
  pode pesar em lotes grandes de avaliação (não é escopo agora).

---

## Pendências — RESOLVIDAS (2026-06-11)

1. **Default do `method`** quando não vem no request → **`"keyword"`**
   (preserva o comportamento atual da extensão; semântico só sob pedido explícito).

2. **Comportamento quando o Gemini falha** no caminho semântico → **erro explícito**
   (sem fallback silencioso; mantém a comparação dos métodos limpa nos experimentos).

Ambas decididas com o usuário. Próximo passo: invocar `writing-plans` para o plano
de implementação.
