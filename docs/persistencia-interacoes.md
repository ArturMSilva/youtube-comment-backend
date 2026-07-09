# Persistência das Interações: Base de Dados para Pesquisa

**Status:** ✅ Implementado no código (2026-07-09) — ⚠️ banco ainda não provisionado
**Motivação:** Sugestão do orientador em reunião: as interações com a ferramenta devem ser armazenadas para que a base resultante possa servir de insumo a pesquisas futuras.
**Referências:** `docs/superpowers/specs/2026-07-09-persistencia-interacoes-design.md` (design), `docs/superpowers/plans/2026-07-09-persistencia-interacoes.md` (plano)

---

## 1. O Problema

Até esta implementação, o backend era *stateless*: cada requisição ao `/api/ask` era processada, respondida e integralmente descartada. A ferramenta funcionava, mas não deixava rastro.

Isso significa que informações produzidas no instante do processamento — quais comentários o RAG selecionou, em que ordem, quais deles o LLM efetivamente citou — existiam por alguns segundos na memória de uma função serverless e desapareciam. Nenhuma dessas informações é recuperável *a posteriori*: reexecutar a mesma pergunta no mesmo vídeo produz outro resultado, porque o modelo é estocástico e os comentários do vídeo mudam com o tempo.

Persistir essas interações transforma o uso da ferramenta em coleta de dados.

---

## 2. O Que É Armazenado

O orientador especificou cinco itens: **pergunta**, **resposta**, **comentários-fonte** (os citados pelo LLM), **comentários filtrados** (os 30 selecionados pelo RAG) e o **link do vídeo** (`videoId`).

A implementação armazena esses cinco, mais quatro metadados que o backend já conhece no momento do processamento e que seriam perdidos para sempre se não fossem gravados ali:

| Campo | Por que existe |
|---|---|
| `metodo` | `keyword` ou `semantic`. É a **variável experimental** do trabalho. Sem ele, as duas abordagens de recuperação ficam indistinguíveis na base e nenhuma comparação é possível. |
| `modelo_llm` | O `askGroq` troca do `llama-3.3-70b-versatile` para o `mixtral-8x7b-32768` silenciosamente quando o primeiro retorna erro 429 (*rate limit*). Sem esta coluna, respostas de modelos diferentes se misturam e qualquer avaliação de qualidade fica contaminada. |
| `total_comentarios_recebidos` | Contextualiza o *top*-30. Filtrar 30 comentários de um universo de 500 é um problema qualitativamente distinto de filtrar 30 de 35. |
| `latencia_filtro_ms` | Mede o custo computacional da etapa de filtragem. Permite quantificar o quanto a busca semântica (que embeda todos os comentários via Gemini) é mais cara que a busca por palavra-chave. |

### O que deliberadamente **não** é armazenado

**O corpus completo de comentários.** A extensão envia até 500 comentários por requisição; apenas os 30 filtrados são gravados. Decisão consciente, tomada para manter a base enxuta. A consequência aceita é que não será possível, retroativamente, reexecutar a filtragem sobre dados históricos com outro método ou outro *top-N*.

**Qualquer identificador de usuário.** Um `sessao_id` anônimo foi considerado e descartado: introduziria um identificador de usuário — ainda que não nominal — exigindo justificativa de coleta e retenção, em troca de um ganho analítico que não foi solicitado.

---

## 3. Modelagem: Por Que Duas Tabelas

O pedido do orientador descreve uma tabela. A implementação usa duas, e a razão está na natureza dos dados.

Uma interação é **uma** pergunta e **uma** resposta, mas se relaciona com **N** comentários — e cada comentário tem um *papel*: foi um dos 30 filtrados? foi citado como fonte?

O ponto decisivo é que **os comentários-fonte são um subconjunto dos filtrados**. Isso não é uma escolha de modelagem, é como o sistema funciona: o LLM recebe os 30 comentários numerados e responde citando `FONTES: [1, 3, 7]`; a função `parseResponse` (`lib/llm.ts`) mapeia esses índices de volta para a lista dos 30.

Guardar "filtrados" e "fontes" como duas listas separadas duplicaria o texto dos comentários citados e perderia a informação de qual posição no *ranking* cada um ocupava.

### Schema

```sql
CREATE TABLE interacoes (
  id                          UUID          PRIMARY KEY,   -- gerado pela aplicação
  video_id                    TEXT,                        -- id do YouTube; NULL se não enviado
  pergunta                    TEXT          NOT NULL,
  resposta                    TEXT          NOT NULL,
  metodo                      TEXT          NOT NULL,
  modelo_llm                  TEXT,
  total_comentarios_recebidos INTEGER       NOT NULL,
  latencia_filtro_ms          INTEGER,
  criado_em                   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_int_metodo CHECK (metodo IN ('keyword', 'semantic'))
);

CREATE TABLE interacao_comentarios (
  id            BIGSERIAL  PRIMARY KEY,
  interacao_id  UUID       NOT NULL REFERENCES interacoes(id) ON DELETE CASCADE,
  comentario_id TEXT       NOT NULL,   -- id do comentário no YouTube
  texto         TEXT       NOT NULL,
  like_count    INTEGER    NOT NULL,
  posicao       SMALLINT   NOT NULL,   -- 1..30, ordem do ranking de relevância
  foi_fonte     BOOLEAN    NOT NULL DEFAULT false,
  UNIQUE (interacao_id, posicao)
);
```

Cada pergunta gera **uma** linha em `interacoes` e **até 30** em `interacao_comentarios`. Os comentários-fonte não são linhas próprias: são as linhas com `foi_fonte = true`.

### A coluna `posicao`

É o campo que transforma a base de um *registro do que aconteceu* em um *instrumento de medida*.

Sem ela, sabe-se **quais** comentários o LLM citou. Com ela, sabe-se **onde** esses comentários estavam no *ranking* de relevância produzido pelo RAG. Isso permite perguntar se o LLM tende a citar os comentários mais bem colocados, e se os dois métodos de recuperação diferem nesse aspecto — que é o cerne da avaliação do sistema.

---

## 4. Decisões Técnicas

### 4.1. Neon (Postgres) + Drizzle ORM

**Neon** é Postgres gerenciado, com *free tier* e integração nativa com a Vercel. Ser relacional importa: um pesquisador futuro consulta a base com SQL e exporta CSV para R, Python ou Excel, sem depender do código da aplicação.

**Drizzle** foi escolhido sobre o Prisma por causa do ambiente serverless. É TypeScript puro, sem *engine* binária e sem etapa de geração de código, o que mantém o *cold start* desprezível. O schema (`db/schema.ts`) é a fonte da verdade: os tipos TypeScript são inferidos dele.

As colunas usam `snake_case` no banco e `camelCase` no TypeScript. O Drizzle faz o mapeamento, e o SQL escrito à mão para análise permanece idiomático.

### 4.2. Atomicidade: `db.batch()` e o `id` UUID

Não deve existir uma linha em `interacoes` sem os seus `interacao_comentarios`. A solução natural seria uma transação — mas o driver HTTP do Neon **não as suporta**. Verificado em `drizzle-orm@0.45.2`:

```js
// node_modules/drizzle-orm/neon-http/session.js:151
async transaction(_transaction, _config = {}) {
  throw new Error("No transactions support in neon-http driver");
}
```

O que existe é `db.batch([...])`, que envia todas as *queries* como **uma única transação HTTP atômica**.

Há um porém: `batch()` não permite que uma *query* use o resultado da anterior. Com um `id BIGSERIAL`, seria necessário inserir a interação, ler o `id` gerado pelo banco e só então inserir os filhos — duas idas ao banco, não atômicas.

Daí a decisão de gerar o identificador na aplicação: **`interacoes.id` é um `UUID` produzido por `crypto.randomUUID()`**. Conhecendo o `id` antes de inserir, as duas *queries* tornam-se independentes e cabem no mesmo `batch()`. Isso evita adotar o driver WebSocket e a dependência `ws`.

### 4.3. `CHECK` no banco, não só no TypeScript

O Drizzle aceita `text('metodo', { enum: ['keyword', 'semantic'] })`, mas esse `enum` **só existe em tempo de compilação** — não gera constraint no Postgres. Como a base é para pesquisa e sobreviverá ao código que a alimenta, a garantia foi declarada explicitamente no banco (`ck_int_metodo`).

### 4.4. Persistência *best-effort*

Se a gravação falhar, o `/api/ask` **responde 200 assim mesmo**, registrando o erro em log:

```ts
try {
  await salvarInteracao(getDb(), { /* ... */ })
} catch (error) {
  console.error('Falha ao persistir interação:', error)
}
```

O *free tier* do Neon hiberna após período de inatividade, portanto falhas esporádicas são esperadas. A escolha é perder uma linha da base, nunca a resposta ao usuário — a coleta de dados é secundária à função da ferramenta.

Pelo mesmo motivo, o `videoId` é **opcional** na requisição e `NULL`-able na tabela: uma versão da extensão em cache no navegador, que ainda não envie o campo, não pode fazer a requisição falhar.

---

## 5. Arquitetura

### Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `db/schema.ts` | Definição das tabelas em Drizzle. Fonte da verdade dos tipos. |
| `lib/db.ts` | Instancia o client Neon HTTP + Drizzle (`getDb()`). |
| `lib/persistence.ts` | `montarLinhas` (pura) e `salvarInteracao` (única escrita no banco). |
| `drizzle/` | Migrations SQL geradas pelo `drizzle-kit`. |

A separação entre `montarLinhas` e `salvarInteracao` é intencional: toda a lógica interessante — numerar a `posicao` a partir de 1 e marcar `foi_fonte` — está na função pura, testável sem banco de dados.

### Fluxo

```
POST /api/ask { pergunta, comentarios, method?, videoId? }
      │
      ├─► validação + CORS
      │
      ├─► selectRelevantComments(...)          ⏱ cronometrado → latencia_filtro_ms
      │      └─ 30 comentários, ordenados por relevância
      │
      ├─► askGroq(...)
      │      └─ { resposta, comentarios_fonte, indicesFonte, modelo }
      │
      ├─► salvarInteracao(...)                 ⚠ em try/catch: só loga se falhar
      │      └─ db.batch([ insert interacoes, insert interacao_comentarios ])
      │
      └─► 200 { resposta, comentarios_fonte }
```

O contrato HTTP **não mudou**: a extensão continua recebendo exatamente `{ resposta, comentarios_fonte }`. Os campos `indicesFonte` e `modelo` são internos e não são expostos.

### Mudanças no código existente

**`lib/llm.ts`** — `parseResponse` resolvia `FONTES: [1,3,7]` em objetos `Comment` e **descartava os índices**. Como `foi_fonte` é marcado por posição no *ranking*, os índices passaram a ser devolvidos (`indicesFonte`, 0-based). O `askGroq` também passou a informar qual dos dois modelos Groq respondeu.

**`service-worker.js` (extensão)** — o `videoId` era desestruturado da mensagem `ASK_LLM` mas nunca repassado ao backend. A função `callLLM` passou a incluí-lo no corpo do POST.

---

## 6. Consultas de Pesquisa

O objetivo da base é permitir consultas como estas, em SQL puro:

```sql
-- Os comentários citados pelo LLM tendem a estar no topo do ranking?
-- E isso difere entre os dois métodos de recuperação?
SELECT i.metodo,
       COUNT(*)            AS citacoes,
       AVG(ic.posicao)     AS posicao_media,
       STDDEV(ic.posicao)  AS desvio
FROM interacoes i
JOIN interacao_comentarios ic ON ic.interacao_id = i.id
WHERE ic.foi_fonte
GROUP BY i.metodo;
```

```sql
-- Quanto a busca semântica custa a mais, em tempo de filtragem?
SELECT metodo,
       AVG(latencia_filtro_ms) AS media_ms,
       MAX(latencia_filtro_ms) AS pior_caso_ms
FROM interacoes
GROUP BY metodo;
```

```sql
-- O LLM cita comentários com mais likes do que a média dos que recebeu?
SELECT ic.foi_fonte, AVG(ic.like_count) AS likes_medios
FROM interacao_comentarios ic
GROUP BY ic.foi_fonte;
```

```sql
-- Quantas perguntas por vídeo, e quantos comentários cada vídeo forneceu?
SELECT video_id,
       COUNT(*)                         AS perguntas,
       MAX(total_comentarios_recebidos) AS comentarios_disponiveis
FROM interacoes
WHERE video_id IS NOT NULL
GROUP BY video_id
ORDER BY perguntas DESC;
```

---

## 7. Considerações Éticas

Nenhum dado de identificação do autor do comentário é armazenado. O tipo `Comment` manipulado pelo sistema contém apenas `id`, `text` e `likeCount` — nome de usuário e canal nunca são coletados da YouTube Data API.

O `comentario_id` armazenado é o identificador público do comentário no YouTube e é, em tese, resolvível de volta ao seu autor por meio da API da plataforma. Trata-se de conteúdo publicado abertamente, mas essa característica deve ser declarada explicitamente no texto do TCC, e não omitida.

Nenhum identificador de usuário da extensão é coletado.

---

## 8. Limitação Conhecida

**A extensão nunca envia o campo `method`.** O `payload` construído em `callLLM` (`service-worker.js`) contém apenas `pergunta`, `comentarios` e `videoId`. Como o `api/ask.ts` aplica `body.method === 'semantic' ? 'semantic' : 'keyword'`, toda requisição real cai no caminho `keyword`.

A busca semântica está implementada (`lib/embeddings.ts`, `semanticFilterComments`) e coberta por testes, mas **nenhum caminho da interface a aciona**.

Consequência para a base: a coluna `metodo` receberia `'keyword'` em 100% das linhas, e a comparação entre os dois métodos — a razão pela qual o campo existe — seria impossível com dados reais.

Resolver isso exige uma decisão de produto sobre como expor a escolha do método ao usuário (um seletor no *popup*? alternância automática para fins de experimento?). **Está em aberto.**

---

## 9. Passos Manuais Pendentes

O código está implementado, testado (45 testes) e integrado à `main`. O caminho de escrita, contudo, **nunca foi executado contra um Postgres real** — os testes usam um duplo de banco.

Falta:

1. Provisionar o Postgres no Neon (via Vercel Marketplace ou diretamente em `neon.tech`).
2. Copiar a *connection string* para `youtube-comment-backend/.env` como `DATABASE_URL`.
3. Rodar `npm run db:migrate` para criar as tabelas.
4. Adicionar `DATABASE_URL` às variáveis de ambiente do projeto na Vercel e fazer novo *deploy*.
5. Testar de ponta a ponta no Chrome e conferir as linhas gravadas (`npm run db:studio`).

### Comandos

```bash
npm run db:generate   # Gera migration SQL a partir de db/schema.ts
npm run db:migrate    # Aplica as migrations no Neon
npm run db:studio     # Drizzle Studio: navega visualmente nos dados
```
