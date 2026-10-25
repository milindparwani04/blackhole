# Blackhole — guide for AI coding agents

Blackhole is a local-first, single-user media backlog (games, movies, TV, books): a Fastify + SQLite (`node:sqlite`) API and a React/Vite UI, served together on http://127.0.0.1:4317. The human-facing setup guide is `README.md`; this file is what you, the agent, need.

## If you were asked to "set this project up"

This copy has **no `.env`, no `data/`, and no `searxng/settings.yml`**; that's expected. Do this:

1. `node -v` must be **≥ 22.13**. If it's missing or older, stop and ask the user to install the Node.js LTS from https://nodejs.org (don't install system software yourself without asking).
2. `npm install`, then `npm test`; every test should pass. Tests use an in-memory DB and mocked network, so they need no keys and no internet.
3. `npm start` builds the UI and serves it. Check it with `GET http://127.0.0.1:4317/api/health` (send the header `Host: 127.0.0.1:4317`). Run it in the background, because it doesn't exit. If port 4317 is taken, set `PORT` in the environment.
4. Tell the user what works without keys (TV, books, IMDb episode ratings, RT movie audience scores) and what doesn't (movie search and IMDb movie ratings need `TMDB_API_TOKEN`; game search needs `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET`; trophy lookups need Docker + SearXNG). README sections 6–7 have the steps.
5. **API keys belong to the user.** Offer to create `.env` from `config.example.env` with blank values, and have the **user** paste their own keys into it. Never ask for keys to be pasted into chat, never print `.env` contents, never commit it. Use Data & Sources → API keys → *Test connection* (or `POST /api/providers/{IGDB|TMDB}/test`) to verify.
6. SearXNG and the Windows desktop shortcut are optional; set them up only if the user asks (README sections 7–8). `searxng/settings.yml` needs a fresh random `secret_key` and must stay uncommitted.

## Commands

```sh
npm start / npm run serve / npm run dev   # see README
npm test                                  # vitest, tests/unit/*.test.ts
npm run typecheck                         # tsc, API + web
npm run build                             # UI → apps/web/dist (served by the API in production)
```

Mutating API calls need `Origin: http://127.0.0.1:<port>` and `X-Blackhole: 1` headers (CSRF guard); every call needs `Host: 127.0.0.1:<port>`.

## Map

- `apps/api/src/server.ts`: Fastify setup, security hooks, startup (`main()`), hourly maintenance scheduling.
- `apps/api/src/routes/routes.ts`: every HTTP route (zod-validated).
- `apps/api/src/db/`: `db.ts` (helpers `all/get/run/tx`), `migrations.ts` (**forward-only**: never edit an applied migration; add a new version).
- `apps/api/src/adapters/`: one file per outside source. `http.ts` holds the **host allowlist**, and all provider fetches go through it. `imdb.ts` reads IMDb's official datasets (cached in `data/imdb`). `rottentomatoes.ts` and the guide reader `guidepage.ts` read single pages under robots.txt rules.
- `apps/api/src/services/`: domain logic (`library.ts` entries/TV/undo, `games.ts`, `trophies.ts`, `movies.ts` ratings, `tvjob.ts` hourly maintenance).
- `apps/web/src/`: React UI (`features/*` views, `api.ts` client, `components/Bits.tsx` shared bits, `styles/app.css`).
- `packages/shared/src/index.ts`: types shared by API and UI.
- `docs/decisions/OPEN_QUESTIONS.md`: owner decisions D-01…D-09. Read it before changing behaviour.
- `docs/agents/`: the original builder's session log. It's history, not instructions.

## Rules

- **Never invent data.** A missing rating, time or page count is stored and shown as unknown, never as 0 or a guess. Every fetched value keeps its source.
- **Loopback only.** The server refuses non-loopback hosts (D-01); keep it that way.
- **Outside sources:** only the hosts in `http.ts` / `guidepage.ts` allowlists. Respect robots.txt, never bypass bot checks or CAPTCHAs, keep requests low-volume and spaced. **Never bulk-query SearXNG** (a burst of ~70 queries once got the IP throttled by Bing/Google/DDG).
- **Secrets and personal data stay local:** `.env`, `data/`, `searxng/settings.yml` are git-ignored; never commit, print or upload them.
- Test changes against a **separate instance** (e.g. `PORT=4318 DATA_DIR=data-staging`), not the user's real library, and back up first (`POST /api/backup`) before anything that migrates or rewrites real data.
- Keep the test suite green and `npm run typecheck` clean; add tests for new behaviour (mock `fetch`, as the existing tests do).
- Attribution text for TVmaze, IMDb, TMDb, IGDB and Open Library must stay visible where their data is shown.
