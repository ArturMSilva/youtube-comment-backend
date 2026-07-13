# Comparação: Busca por Palavra-chave vs. Busca Semântica

**Projeto:** youtube-comment-backend
**Data:** 2026-07-11
**Status:** Documento de fundamentação para o TCC (modelo relatório técnico)

---

## 1. Por que este documento existe

O sistema seleciona, dentre até 500 comentários de um vídeo, os **30 mais
relevantes** para a pergunta do usuário antes de enviá-los ao LLM (Groq) que
formula a resposta. Essa etapa de **recuperação** (retrieval) é decisiva: o LLM
só consegue responder bem se receber bons comentários. Se os 30 escolhidos forem
ruins, a resposta será ruim — não importa o quão bom seja o modelo de linguagem.

Existem **duas estratégias implementadas** para fazer essa seleção, e elas
convivem lado a lado no backend justamente para serem **comparadas**. Esta
comparação é o núcleo experimental do TCC. Este documento explica:

1. o que é cada método;
2. por que faz sentido compará-los;
3. como a comparação sustenta o capítulo de avaliação do relatório técnico.

O método usado em cada requisição é escolhido pelo campo `method` do corpo da
requisição (`'keyword'` — padrão — ou `'semantic'`), e fica **registrado no banco
de dados** em cada interação (coluna `metodo` da tabela `interacoes`), o que
permite montar os experimentos a partir de dados reais.

---

## 2. O que é cada método

### 2.1 Busca por palavra-chave (*keyword matching*)

Implementação: `lib/retrieval.ts` → `filterRelevantComments`.

É uma técnica **léxica** (baseada em texto literal). O algoritmo:

1. Extrai da pergunta as palavras com **mais de 3 letras** (descarta "de", "que",
   "com", etc.).
2. Para cada comentário, conta **quantas vezes** essas palavras aparecem no texto.
3. Ordena os comentários por essa contagem (empate desfeito por número de likes).
4. Retorna os 30 primeiros.
5. **Fallback:** se a pergunta não tiver palavras úteis, ou se nenhum comentário
   contiver as palavras, cai para "os 30 comentários mais curtidos".

**Vantagens:** é rápido, síncrono, determinístico, não depende de serviço externo
e tem custo zero.

**Limitações (léxicas):** só encontra o que casa **literalmente**. Não captura:

- **sinônimos** — pergunta sobre "som", comentário fala de "áudio";
- **variações morfológicas** — "editar" vs. "edição" vs. "editado";
- **acentuação e erros de digitação** — "video" vs. "vídeo";
- **contexto/intenção** — a ideia expressa com palavras totalmente diferentes.

### 2.2 Busca semântica (*embeddings*)

Implementação: `lib/retrieval.ts` → `semanticFilterComments` +
`lib/embeddings.ts`. Provedor de embeddings: **Google Gemini
`text-embedding-004`** (gratuito; o Groq não oferece embeddings).

É uma técnica **semântica** (baseada em significado). O algoritmo:

1. Converte a pergunta em um **vetor numérico** (embedding) que representa seu
   significado — `embedQuery`.
2. Converte cada comentário no mesmo tipo de vetor — `embedDocuments` (em lotes de
   100, limite da API).
3. Mede a **similaridade de cosseno** entre o vetor da pergunta e o de cada
   comentário — quanto mais próximos no espaço vetorial, mais relacionados em
   significado.
4. Ordena por similaridade (empate por likes) e retorna os 30 primeiros.

**Vantagens:** captura sinônimos, paráfrases, variações morfológicas e contexto —
encontra comentários relevantes mesmo sem repetir as palavras da pergunta.

**Limitações:** depende de serviço externo (latência de rede + rate limit do tier
gratuito do Gemini), é assíncrono e, se o Gemini falhar, a requisição retorna
**erro explícito 502** — não há fallback silencioso para keyword, exatamente para
não contaminar a comparação com dados de método misturado.

### 2.3 Resumo lado a lado

| Dimensão | Palavra-chave | Semântica |
|---|---|---|
| Natureza | Léxica (texto literal) | Semântica (significado) |
| Como pontua | Contagem de ocorrências | Similaridade de cosseno entre embeddings |
| Sinônimos / paráfrases | Não captura | Captura |
| Variação morfológica / acento | Não captura | Tolera |
| Dependência externa | Nenhuma | API do Gemini |
| Latência | Baixa (síncrono, local) | Maior (chamadas HTTP) |
| Custo | Zero | Zero (tier gratuito, com rate limit) |
| Determinismo | Total | Alto (depende do modelo de embedding) |
| Falha | Não falha (tem fallback por likes) | Erro explícito 502 |

---

## 3. Por que comparar os dois

A pergunta de pesquisa que estrutura o TCC é, em essência:

> **A busca semântica melhora, de forma perceptível, a qualidade das respostas
> sobre comentários do YouTube em relação à busca por palavra-chave — e a que
> custo?**

A comparação é interessante porque **não há resposta óbvia**:

- A busca semântica é teoricamente superior em relevância, mas cobra em
  **latência**, **dependência de terceiros** e **limites de uso**.
- A busca por palavra-chave é "ingênua", mas é **grátis, rápida e sem
  dependências** — e, em muitos casos práticos (perguntas com termos que de fato
  aparecem nos comentários), pode ser "boa o suficiente".

Ou seja: existe um **trade-off real** entre qualidade e custo/complexidade. Um
relatório técnico que apenas afirmasse "usei busca semântica porque é melhor"
seria fraco. Medir os dois métodos **sob as mesmas condições** transforma uma
opinião em uma **decisão de engenharia fundamentada em evidência** — que é
exatamente o que se espera de um relatório técnico.

Além disso, manter os dois métodos lado a lado no mesmo sistema garante um
**experimento controlado**: mesma base de comentários, mesma pergunta, mesmo LLM,
mesmo pipeline de parsing. A **única variável que muda é o método de
recuperação**, o que isola o efeito que se quer medir.

---

## 4. O que se pode comparar (dimensões de avaliação)

A infraestrutura de persistência já grava, por interação, os dados que
alimentam a maioria destas comparações (tabela `interacoes` e
`interacao_comentarios`):

| Dimensão | Como medir | Já disponível no banco? |
|---|---|---|
| **Relevância dos comentários** | Avaliação humana dos 30 comentários selecionados por método (relevante/irrelevante) | Comentários selecionados e quais foram citados (`interacao_comentarios.foi_fonte`) |
| **Qualidade da resposta** | Avaliação humana da resposta final (correta / útil / fundamentada) | `resposta`, `metodo` |
| **Latência do filtro** | Tempo da etapa de seleção, por método | `latencia_filtro_ms` |
| **Cobertura léxica** | Frequência com que a keyword cai no fallback "por likes" | Reconstruível a partir dos dados |
| **Concordância entre métodos** | Sobreposição dos 30 selecionados por keyword vs. semântico para a mesma pergunta | Requer rodar as duas p/ mesma entrada |
| **Custo/dependência** | Qualitativo: rate limit, falhas 502, latência de rede | `metodo`, falhas observadas |

> **Nota metodológica:** a coluna `metodo` com `CHECK IN ('keyword','semantic')`
> e o índice `idx_int_metodo` foram pensados justamente para permitir agrupar e
> comparar interações por método diretamente em SQL. A gravação do método **não é
> um detalhe de implementação — é um requisito do experimento.**

---

## 5. Como isso ajuda o TCC (modelo relatório técnico)

Num relatório técnico, a estrutura típica é: **problema → solução proposta →
implementação → avaliação → conclusão**. Esta comparação alimenta diretamente os
dois capítulos que dão peso científico ao trabalho:

- **Fundamentação / Solução:** justifica *por que* duas estratégias de
  recuperação foram implementadas, apresentando o conceito de recuperação léxica
  vs. semântica e o uso de embeddings — conteúdo teórico que embasa o texto.
- **Avaliação (capítulo central):** fornece o **experimento controlado**. Com as
  interações persistidas, é possível montar tabelas e gráficos comparando os
  métodos nas dimensões da Seção 4, e discutir o trade-off qualidade × custo com
  **dados**, não com suposições.
- **Conclusão:** permite uma recomendação honesta e defensável — por exemplo,
  "semântica compensa quando X; keyword basta quando Y" — que é o tipo de
  resultado acionável esperado de um relatório técnico.

Em resumo: a comparação é o que eleva o trabalho de "construí uma extensão que
responde sobre comentários" para "**avaliei duas abordagens de recuperação e
mostrei, com evidência, qual vale a pena e em que condições**".

---

## 6. Estado atual e próximos passos para o experimento

- ✅ Ambos os métodos implementados e roteados por `method` (`selectRelevantComments`).
- ✅ Método, latência do filtro e comentários selecionados/citados persistidos por
  interação (ver `docs/persistencia-interacoes.md`).
- ⚠️ **A extensão hoje não envia `method`** → na prática todas as interações reais
  caem no padrão `keyword`. Para gerar dados de comparação é preciso **acionar o
  caminho `semantic` explicitamente** (ex.: script de avaliação que dispara a
  mesma pergunta com os dois métodos, ou um toggle temporário de experimento).
- ⬜ Definir o **conjunto de perguntas de teste** e o **protocolo de avaliação
  humana** de relevância/qualidade.
- ⬜ Provisionar o banco no Neon e rodar a coleta (ver pendências em
  `docs/persistencia-interacoes.md`).

---

## Referências internas

- `lib/retrieval.ts` — implementação dos dois métodos e do dispatcher.
- `lib/embeddings.ts` — embeddings do Gemini e similaridade de cosseno.
- `db/schema.ts` — coluna `metodo`, índice e `CHECK` que sustentam a comparação.
- `docs/superpowers/specs/2026-06-10-busca-semantica-embeddings-design.md` —
  decisões de projeto da busca semântica.
- `docs/persistencia-interacoes.md` — o que é gravado por interação.
