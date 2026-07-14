# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Vercel serverless backend that receives a question plus a list of YouTube comments, filters the most relevant ones (RAG), and returns an AI-generated answer via Groq. Sibling repository to `youtube-comment-extension` (not a subfolder — they are two separate git repos side by side under `TCC/`).

## Commands

```bash
npm install
npm run dev:local     # Local dev server without vercel dev — routes /api/ask and /api/comments (no Vercel login needed)
npm run dev:vercel    # Local dev server via `vercel dev` (needs network access + vercel login)
npm test               # Run all tests once (vitest run)
npm run test:watch     # Watch mode
npm run lint            # tsc --noEmit
npm run db:generate    # Gera migration SQL a partir de db/schema.ts
npm run db:migrate     # Aplica as migrations no Neon (precisa de DATABASE_URL)
npm run db:studio      # Drizzle Studio: navega nos dados persistidos
```

Run a single test file: `npx vitest run tests/retrieval.test.ts`

## Endpoints

- `POST /api/ask` — pergunta + comentários → resposta da IA. `method: 'keyword' | 'semantic'` no body escolhe o filtro de relevância (default: `keyword`). `videoId` é opcional e serve só para a persistência.
- `GET /api/comments?videoId=` — busca comentários de um vídeo do YouTube. A `YOUTUBE_API_KEY` fica só aqui, nunca na extensão.

## Persistência (base de pesquisa)

Cada chamada a `/api/ask` grava no Neon (Postgres, via Drizzle) uma linha em `interacoes` e até 30
em `interacao_comentarios`. Os comentários-fonte não são linhas próprias: são as linhas com
`foi_fonte = true`. Ver `docs/superpowers/specs/2026-07-09-persistencia-interacoes-design.md`.

- `db/schema.ts` — fonte da verdade do schema e dos tipos
- `lib/db.ts` — client Neon HTTP + Drizzle (`getDb()`)
- `lib/persistence.ts` — `montarLinhas` (pura) e `salvarInteracao` (única escrita no banco)

## Git Commit Conventions

- **Commit messages must be written in Portuguese** (matches the existing history — see `git log`).
- Keep the `type: descrição` prefix style (`feat:`, `fix:`, `chore:`, etc.) with the description in Portuguese.
- **Do not add a `Co-Authored-By` trailer** to commits in this repository.

## Key Constraints

- CORS (`lib/cors.ts`, shared by both endpoints) only allows `chrome-extension://` origins and `http://localhost` — do not widen this.
- `GROQ_API_KEY`, `GEMINI_API_KEY` (busca semântica), `YOUTUBE_API_KEY` (`/api/comments`) and `DATABASE_URL` (Neon) must stay in `.env` (gitignored) / Vercel env vars, never hardcoded.
- The semantic search path (`method: 'semantic'`) fails with an explicit `502` if Gemini errors — no silent fallback to keyword.
- A persistência é **best-effort**: se o Neon falhar, `api/ask.ts` apenas loga e responde 200. Nunca vira erro HTTP.
- O driver `neon-http` **não suporta** `db.transaction()` (lança exceção). A atomicidade vem de `db.batch([...])`, e por isso `interacoes.id` é um UUID gerado com `crypto.randomUUID()` em vez de `BIGSERIAL`.
- O enum de `metodo` no Drizzle só existe em tempo de compilação; a garantia real é a constraint `ck_int_metodo` no banco.
