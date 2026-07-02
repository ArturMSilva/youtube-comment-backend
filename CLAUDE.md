# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Vercel serverless backend that receives a question plus a list of YouTube comments, filters the most relevant ones (RAG), and returns an AI-generated answer via Groq. Sibling repository to `youtube-comment-extension` (not a subfolder — they are two separate git repos side by side under `TCC/`).

## Commands

```bash
npm install
npm run dev:vercel    # Local dev server via `vercel dev` (needs network access)
node --env-file=.env -r ts-node/register scripts/dev-server.ts  # Local dev server without vercel dev — routes /api/ask and /api/comments
npm test               # Run all tests once (vitest run)
npm run test:watch     # Watch mode
npm run lint            # tsc --noEmit
```

Run a single test file: `npx vitest run tests/retrieval.test.ts`

## Endpoints

- `POST /api/ask` — pergunta + comentários → resposta da IA. `method: 'keyword' | 'semantic'` no body escolhe o filtro de relevância (default: `keyword`).
- `GET /api/comments?videoId=` — busca comentários de um vídeo do YouTube. A `YOUTUBE_API_KEY` fica só aqui, nunca na extensão.

## Git Commit Conventions

- **Commit messages must be written in Portuguese** (matches the existing history — see `git log`).
- Keep the `type: descrição` prefix style (`feat:`, `fix:`, `chore:`, etc.) with the description in Portuguese.
- **Do not add a `Co-Authored-By` trailer** to commits in this repository.

## Key Constraints

- CORS (`lib/cors.ts`, shared by both endpoints) only allows `chrome-extension://` origins and `http://localhost` — do not widen this.
- `GROQ_API_KEY`, `GEMINI_API_KEY` (busca semântica) and `YOUTUBE_API_KEY` (`/api/comments`) must stay in `.env` (gitignored) / Vercel env vars, never hardcoded.
- The semantic search path (`method: 'semantic'`) fails with an explicit `502` if Gemini errors — no silent fallback to keyword.
