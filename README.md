# YouTube Comment Analysis — Backend

API serverless para análise de comentários do YouTube com IA. Recebe uma pergunta e uma lista de comentários, filtra os mais relevantes e retorna uma resposta gerada pelo modelo de linguagem da Groq.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 24 + TypeScript |
| Deploy | Vercel (Serverless Functions) |
| IA | Groq API — LLaMA 3.3 70B (fallback: Mixtral 8x7B) |
| Testes | Vitest |

---

## Estrutura do projeto

```
├── api/
│   └── ask.ts              # Handler da função serverless (endpoint POST /api/ask)
├── lib/
│   ├── llm.ts              # Integração com Groq: prompt, chamada à API, parse da resposta
│   └── retrieval.ts        # Filtragem de comentários por relevância
├── tests/
│   ├── retrieval.test.ts   # Testes de filtragem
│   └── llm.test.ts         # Testes de parsing da resposta
├── types.ts                # Interfaces TypeScript compartilhadas
├── vercel.json             # Configuração do deploy
└── package.json
```

---

## Endpoint

### `POST /api/ask`

Recebe uma pergunta e uma lista de comentários, retorna uma análise gerada por IA com as fontes usadas.

#### Request

```http
POST /api/ask
Content-Type: application/json
```

```json
{
  "pergunta": "Como está a bateria desse celular?",
  "comentarios": [
    { "id": "1", "text": "A bateria dura o dia todo, muito boa", "likeCount": 120 },
    { "id": "2", "text": "Tela linda e brilhante", "likeCount": 45 },
    { "id": "3", "text": "Bateria melhorou bastante nessa versão", "likeCount": 80 }
  ]
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `pergunta` | `string` | ✅ | Pergunta do usuário (máx. 500 caracteres) |
| `comentarios` | `Comment[]` | ✅ | Lista de comentários do vídeo (não pode estar vazia) |

**Tipo `Comment`:**

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | `string` | Identificador único do comentário |
| `text` | `string` | Texto do comentário |
| `likeCount` | `number` | Número de likes |

#### Response `200 OK`

```json
{
  "resposta": "A bateria do aparelho é bem avaliada pelos usuários, com relatos de que dura o dia todo e melhorou em relação a versões anteriores.",
  "comentarios_fonte": [
    { "id": "1", "text": "A bateria dura o dia todo, muito boa", "likeCount": 120 },
    { "id": "3", "text": "Bateria melhorou bastante nessa versão", "likeCount": 80 }
  ]
}
```

| Campo | Tipo | Descrição |
|---|---|---|
| `resposta` | `string` | Resposta gerada pela IA (2–4 frases em português) |
| `comentarios_fonte` | `Comment[]` | Comentários que embasaram a resposta |

#### Respostas de erro

| Status | Situação |
|---|---|
| `400` | `pergunta` ausente/vazia ou `comentarios` vazio/ausente |
| `405` | Método HTTP diferente de POST |
| `5xx` | Erro interno ou falha na Groq API |

---

## Como funciona internamente

### 1. CORS (`api/ask.ts`)

Aceita requisições apenas de origens autorizadas:
- Extensões Chrome: `chrome-extension://*`
- Desenvolvimento local: `http://localhost`

Requisições `OPTIONS` (preflight) são respondidas com `204 No Content`.

### 2. Filtragem por relevância (`lib/retrieval.ts`)

Antes de chamar a IA, os comentários são filtrados para reduzir tokens e aumentar a precisão:

1. A pergunta é tokenizada — palavras com mais de 3 letras viram keywords
2. Cada comentário recebe um **score** (contagem de ocorrências das keywords)
3. Os `topN` (padrão: 30) comentários com maior score são selecionados
4. **Fallback:** se nenhum comentário tiver match, retorna os 30 com mais likes

> **Detalhe:** caracteres especiais de regex nas keywords (`(`, `)`, `.`, `*` etc.) são escapados automaticamente para evitar erros de `SyntaxError` no `RegExp`.

### 3. Geração de resposta com IA (`lib/llm.ts`)

O prompt enviado à Groq inclui:
- Os comentários filtrados numerados com seus likes
- A pergunta do usuário
- Instrução para responder em português (2–4 frases)
- Instrução para listar as fontes no formato `FONTES: [1, 3, 7]`

**Modelos usados:**

| Modelo | Papel |
|---|---|
| `llama-3.3-70b-versatile` | Modelo primário |
| `mixtral-8x7b-32768` | Fallback automático se o primário retornar erro `429` (rate limit) |

Parâmetros fixos: `temperature: 0.3`, `max_tokens: 1024`.

### 4. Parse da resposta (`lib/llm.ts → parseResponse`)

A resposta bruta do modelo é processada para:
- Separar o texto da resposta da linha `FONTES: [...]`
- Converter os índices (base 1) para referências reais nos comentários filtrados
- Ignorar índices fora do intervalo válido

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GROQ_API_KEY` | ✅ | Chave de API da [Groq](https://console.groq.com/) |

---

## Rodando localmente

```bash
# Instalar dependências
npm install

# Criar arquivo de variáveis de ambiente
echo "GROQ_API_KEY=sua_chave_aqui" > .env

# Rodar com Vercel Dev (recomendado — simula o ambiente serverless)
npm run dev:vercel

# Endpoint disponível em:
# http://localhost:3000/api/ask
```

---

## Testes

```bash
# Rodar todos os testes
npm test

# Modo watch
npm run test:watch

# Com cobertura
npm run test:coverage
```

### O que é testado

**`tests/retrieval.test.ts`**
- Filtra corretamente por keywords da pergunta
- Fallback para top por likes quando sem match
- Respeita o limite `topN`
- Retorna array vazio para lista de comentários vazia

**`tests/llm.test.ts`**
- Extrai `resposta` e `comentarios_fonte` corretamente
- Retorna fontes vazias quando `FONTES` não está na resposta
- Ignora índices fora do range da lista
- Remove a linha `FONTES` do texto exibido

---

## Deploy

```bash
# Preview
vercel

# Produção
vercel --prod
```

O `vercel.json` configura a função com:
- **Memória:** 256 MB
- **Timeout máximo:** 30 segundos
- **Builder:** `@vercel/node` (TypeScript nativo)
