# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Vercel serverless backend that receives a question plus a list of YouTube comments, filters the most relevant ones (RAG), and returns an AI-generated answer via Groq. Sibling repository to `youtube-comment-extension` (not a subfolder — they are two separate git repos side by side under `TCC/`).

## Commands

```bash
npm install
npm run dev:vercel    # Local dev server at http://localhost:3000/api/ask
npm test               # Run all tests once (vitest run)
npm run test:watch     # Watch mode
npm run lint            # tsc --noEmit
```

Run a single test file: `npx vitest run tests/retrieval.test.ts`

## Git Commit Conventions

- **Commit messages must be written in Portuguese** (matches the existing history — see `git log`).
- Keep the `type: descrição` prefix style (`feat:`, `fix:`, `chore:`, etc.) with the description in Portuguese.
- **Do not add a `Co-Authored-By` trailer** to commits in this repository.

## Key Constraints

- CORS in `api/ask.ts` only allows `chrome-extension://` origins and `http://localhost` — do not widen this.
- `GROQ_API_KEY` (and `GEMINI_API_KEY` once the semantic search feature lands) must stay in `.env` (gitignored) / Vercel env vars, never hardcoded.
