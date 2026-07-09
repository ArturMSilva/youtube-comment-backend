# Persistência de interações para pesquisa futura

**Data:** 2026-07-09
**Status:** Aprovado (design)

## Contexto e motivação

Sugestão do orientador: as interações com a ferramenta devem ser persistidas para que a base
resultante possa servir de insumo a pesquisas futuras. Hoje o backend é serverless puro, sem
nenhum banco de dados — cada requisição a `/api/ask` é processada e descartada.

Os dados que o orientador pediu explicitamente:

- pergunta
- resposta
- comentários-fonte (os ~3 que o LLM citou)
- comentários filtrados (os 30 selecionados pelo RAG)
- link do vídeo (`videoId`)

## Escopo

**Dentro do escopo:** persistir cada interação de `/api/ask` no Neon (Postgres), via Drizzle ORM.

**Fora do escopo:**

- Persistir o corpus completo de comentários (até 500 por vídeo). Decisão consciente: mantém a
  base enxuta. Consequência aceita — não será possível, retroativamente, re-executar a filtragem
  sobre dados históricos com outro método ou outro top-N.
- Qualquer identificador de usuário ou de sessão.
- Endpoint de leitura/exportação. A análise se dá por SQL direto no Neon.

## Decisões de design

| Decisão | Escolha | Razão |
|---|---|---|
| Banco | Neon (Postgres) | Relacional, free tier, SQL para análise e exportação CSV |
| ORM | Drizzle | TypeScript puro, sem codegen, cold start desprezível em serverless |
| Modelagem | Duas tabelas com papel do comentário | Fonte é subconjunto dos filtrados; evita duplicar texto |
| Falha na escrita | Best-effort: loga e responde 200 | O Neon free tier hiberna; a ferramenta não pode quebrar por isso |
| Momento da escrita | Antes de responder | Simples e testável; ~50-150ms é irrelevante perto da latência do Groq |
| `video_id` ausente | Grava `NULL`, não rejeita | Extensão em cache não pode quebrar a requisição |

## Schema

```sql
CREATE TABLE interacoes (
  id                          BIGSERIAL     PRIMARY KEY,
  video_id                    TEXT,
  pergunta                    TEXT          NOT NULL,
  resposta                    TEXT          NOT NULL,
  metodo                      TEXT          NOT NULL
                                            CHECK (metodo IN ('keyword','semantic')),
  modelo_llm                  TEXT,
  total_comentarios_recebidos INTEGER       NOT NULL,
  latencia_filtro_ms          INTEGER,
  criado_em                   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE interacao_comentarios (
  id            BIGSERIAL  PRIMARY KEY,
  interacao_id  BIGINT     NOT NULL REFERENCES interacoes(id) ON DELETE CASCADE,
  comentario_id TEXT       NOT NULL,
  texto         TEXT       NOT NULL,
  like_count    INTEGER    NOT NULL,
  posicao       SMALLINT   NOT NULL,
  foi_fonte     BOOLEAN    NOT NULL DEFAULT false,
  UNIQUE (interacao_id, posicao)
);

CREATE INDEX idx_ic_interacao  ON interacao_comentarios (interacao_id);
CREATE INDEX idx_int_video     ON interacoes (video_id);
CREATE INDEX idx_int_metodo    ON interacoes (metodo);
CREATE INDEX idx_int_criado_em ON interacoes (criado_em);
```

Cada pergunta gera **1 linha** em `interacoes` e **até 30 linhas** em `interacao_comentarios`.
Os comentários-fonte não têm linhas próprias: são as linhas com `foi_fonte = true`.

### Sobre os campos

`metodo` é a variável experimental do TCC (`keyword` vs `semantic`). Sem ele a base é
inanalisável — as duas abordagens ficam indistinguíveis.

`modelo_llm` registra qual modelo Groq respondeu. `askGroq` troca do `llama-3.3-70b-versatile`
para o `mixtral-8x7b-32768` silenciosamente em caso de rate limit (429). Sem essa coluna,
respostas de modelos diferentes se misturam na base.

`total_comentarios_recebidos` contextualiza o top-30: filtrar 30 de 500 é diferente de filtrar
30 de 35.

`latencia_filtro_ms` mede **apenas** `selectRelevantComments`, não o handler inteiro. A chamada
ao Groq domina a latência total e varia com a fila do provedor, o que contaminaria a comparação
entre `keyword` e `semantic`.

`posicao` (1..30) é o que torna a base um instrumento de medida e não apenas um registro. Sem
ela sabe-se *quais* comentários foram citados, mas não *onde* estavam no ranking.

### Consulta de exemplo

```sql
-- posição média dos comentários citados, por método
SELECT i.metodo, AVG(ic.posicao) AS posicao_media_citada
FROM interacoes i
JOIN interacao_comentarios ic ON ic.interacao_id = i.id
WHERE ic.foi_fonte
GROUP BY i.metodo;
```

## Arquitetura

### Arquivos novos (backend)

- `db/schema.ts` — schema Drizzle (`pgTable`), fonte da verdade dos tipos
- `lib/db.ts` — client `@neondatabase/serverless` + Drizzle
- `lib/persistence.ts` — `salvarInteracao(dados)`, único ponto que escreve no banco
- `drizzle.config.ts` e `drizzle/` — configuração e migrations do `drizzle-kit`

### Mudanças em código existente

**`youtube-comment-extension/service-worker.js` (~linha 188)**
`callLLM(question, comments)` passa a receber e repassar o `videoId` no body do POST. Hoje o
`videoId` é desestruturado na linha 174 e nunca chega ao backend.

**`types.ts`**
`AskRequest` ganha `videoId?: string`.

**`lib/llm.ts`**
`parseResponse` hoje resolve `FONTES: [1,3,7]` em `Comment[]` e descarta os índices. Como
`foi_fonte` é marcado por `posicao`, os índices são necessários. `askGroq` passa a devolver
também `modelo` (qual dos dois modelos respondeu) e `indicesFonte` (0-based).

`api/ask.ts` consome esses dois campos internamente e **não** os expõe na resposta HTTP — o
contrato com a extensão (`{ resposta, comentarios_fonte }`) permanece idêntico.

**`api/ask.ts`**
Ordem: valida → cronometra `selectRelevantComments` → `askGroq` → `salvarInteracao` em
`try/catch` que apenas loga → responde 200.

### Fluxo

```
POST /api/ask { pergunta, comentarios, method?, videoId? }
  → CORS + validação
  → t0 = now(); relevantes = selectRelevantComments(...); latenciaFiltroMs = now() - t0
  → { resposta, comentarios_fonte, modelo, indicesFonte } = askGroq(...)
  → try { salvarInteracao({...}) } catch (e) { console.error(e) }   // best-effort
  → 200 { resposta, comentarios_fonte }
```

## Tratamento de erros

A persistência **nunca** propaga erro ao cliente. `salvarInteracao` é chamada dentro de
`try/catch` e uma falha resulta apenas em `console.error` (visível nos logs da Vercel). O Neon
free tier hiberna após inatividade, portanto falhas esporádicas são esperadas e aceitas: perde-se
aquela linha, não a resposta ao usuário.

**Requisito de atomicidade:** não deve existir linha em `interacoes` sem os seus
`interacao_comentarios`. O driver HTTP do Neon (`neon()`) trata cada query como uma requisição
independente e não oferece transação interativa. A implementação deve resolver isso por
`db.batch()` ou adotando o driver WebSocket (`Pool`), o que for suportado pelo Drizzle na versão
instalada — a verificar no primeiro passo da implementação. Se nenhum caminho for viável, a
alternativa é aceitar a escrita não-atômica e limpar interações órfãs por query, o que é aceitável
dado que a persistência é best-effort.

## Testes

- `lib/persistence.ts` recebe o client de banco por injeção, permitindo testá-lo com um duplo em
  vez de exigir Postgres na suíte.
- Teste: `salvarInteracao` marca `foi_fonte = true` exatamente nas posições de `indicesFonte`.
- Teste: `salvarInteracao` grava `posicao` 1..N na ordem do ranking recebido.
- Teste: `api/ask` responde 200 mesmo quando `salvarInteracao` rejeita.
- Teste: `api/ask` responde 200 e grava `video_id` nulo quando o body não traz `videoId`.
- Teste (`llm.test.ts`): `parseResponse` devolve `indicesFonte` coerentes com `comentarios_fonte`.

## Variáveis de ambiente

| Variável | Onde | Uso |
|---|---|---|
| `DATABASE_URL` | `.env` local / dashboard da Vercel | Conexão com o Neon |

Segue o mesmo padrão de `GROQ_API_KEY`, `GEMINI_API_KEY` e `YOUTUBE_API_KEY`: nunca no código.
Adicionar a `.env.example`.

## Considerações éticas

Não são armazenados nome nem canal do autor — o tipo `Comment` do projeto contém apenas `id`,
`text` e `likeCount`. O `comentario_id` do YouTube é, em tese, resolvível de volta ao autor via
API do YouTube. Trata-se de conteúdo público, e o TCC deve declarar isso explicitamente.

Nenhum identificador de usuário da extensão é coletado (`sessao_id` foi considerado e descartado).
