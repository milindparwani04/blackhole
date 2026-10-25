# Agent claude-opus-blackhole-01 handoff — 2026-10-25T07:20Z

- **Assigned ticket and requirements:** Owner asked to "build it on a local server". Delivered milestones 1.2, 1.3 (migrations + backup; restore UI pending), 2.1–2.3, 4.1, 5.1–5.3, 6.1 (with TVmaze ratings rather than synthetic data — see D-03), partial 3.3/3.4 (TVmaze, Open Library). FR-01, FR-03, FR-05 (gated), FR-06, FR-07, FR-09 (no series), FR-11 (backup/export only).
- **Goal:** First working vertical slice of the whole app, on loopback, with no external keys needed.
- **Files / design decisions:** Fastify 5 + zod 4 API (`apps/api/src`), built-in `node:sqlite` (avoids native builds on Windows), React 18 + Vite (`apps/web`), shared contracts in `packages/shared`. Single-user model: one `library_entries` row per `media_items` row. Undo = entry snapshot (+ episode states) in `progress_events.payload`; only the latest active event per entry is undoable to avoid clobbering later edits. No ADR-001 written yet — Fastify chosen over Express.
- **Implemented / unfinished:** see README "What works". Unfinished: IGDB/TMDb adapters, Letterboxd import, book series, release calendar, restore preview, CI, Playwright E2E, AGENTS.md / PR template / branch protection.
- **Commands/tests:** `npm test` → 17/17 pass (security boundary, CRUD, idempotent provider add, archive/delete, optimistic concurrency, story vs platinum independence, undo, gated refresh, TV arithmetic incl. specials/unaired/estimated runtime, bulk season + undo, books page bounds). `tsc` clean for API and web. `npm run build` OK. Manual browser check on a staging instance (port 4318, separate data dir, since deleted): dashboard, game inspector, heatmap with Person of Interest, Open Library search.
- **Security/licence assumptions:** TVmaze (CC BY-SA, attribution shown) and Open Library used live — **not owner-approved yet (D-03)**. No scraping; adapters can only reach `api.tvmaze.com` / `openlibrary.org`. Images allowed from any https host in CSP `img-src` (manual cover URLs).
- **DB migration/backup/rollback:** Migration v1 only. Backup = `VACUUM INTO data/backups/*.sqlite`. Rollback = stop server, replace `data/blackhole.sqlite` with a backup.
- **Bugs/limitations:** Open Library median page counts are work-level (labelled). Some Open Library results lack covers. TVmaze specials numbered by air order. Year sort with two unknown years is unstable.
- **Next smallest safe task:** Restore-from-backup preview (FR-11), then Playwright E2E for add/complete/undo, then CI workflow.
- **PR/commit refs:** Branch `feat/1.2-local-foundation-mvp`; nothing committed yet (awaiting owner).

## Update — 2026-10-25T07:45Z: API key setup
- **Ticket:** owner asked to set up API keys. Milestones 3.2 (IGDB) and 3.3 (TMDb movies) adapters.
- **Changes:** `apps/api/src/config.ts` (reads .env, re-reads on change — no restart), `adapters/igdb.ts` (Twitch client-credentials token cached, one forced refresh on 401/403, Apicalypse query sanitised), `adapters/tmdb.ts` (v4 Bearer or v3 api_key; detail call fills runtime/director/genres only where empty), `http.ts` host allowlist + image hosts, `POST /api/providers/:p/test`, `/api/providers` exposes `configured` booleans only. UI: API KEYS panel with steps + Test connection. `.env` created from `config.example.env` with blank values (git-ignored).
- **Tests:** 24/24 pass (7 new, mocked fetch: token caching/refresh, mapping, injection stripping, secret never in responses, v3/v4 TMDb auth, NOT_CONFIGURED fallback). Live keys **not** tested — owner has not created accounts yet.
- **Not done:** IGDB game_time_to_beats import (needs D-07). Trophy SEARCH_PROVIDER_KEY unused (D-02).
- **Next:** owner pastes keys → click Test connection on Data & Sources.

## Update — 2026-10-25: live key verification
- Owner added keys. `POST /api/providers/{IGDB,TMDB}/test` both ok (Witcher 3 / The Matrix sample lookups).
- Live searches: "resident evil 4" returns 2005 PS2/PC, 2005 GameCube, 2011 HD, 2023 remake as distinct IDs; "dune" returns 1984, 2020, 2021, Part Two, Part Three.
- Staging (port 4318, deleted afterwards): TMDb add of Dune (2021) enriched runtime 155 + director Denis Villeneuve; re-add returned duplicate=true; IGDB add of RE4 (2023) kept platforms, platinum_applicable=true; search marks only the 2023 entry as in the Pit.

## Update — 2026-10-25: owner decisions D-01…D-08 implemented
- **Decisions:** recorded in `docs/decisions/OPEN_QUESTIONS.md`.
- **Changes:** migration v2 (`play_platform`, `trophy_lookup_jobs`, SEARXNG registry row); `adapters/searxng.ts` (serialised queue, throttling → RATE_LIMITED); `services/trophies.ts` (labelled-value parser, guide-page/title/year/platform matching, jobs: ADD/PLATFORM_CHANGE auto-apply unless manual values, REFRESH → NEEDS_REVIEW, apply/revert with snapshot); `services/games.ts` (IGDB normal time, backfill of play_platform); `services/tvjob.ts` (hourly TV re-sync + reopen); D-04 status logic in `library.ts`; UI: version chooser in Add, Playing on switch, trophy review/revert/evidence, Normal time column, branding removed, SearXNG card.
- **Infra:** Docker container `blackhole-searxng` (searxng/searxng:latest) on 127.0.0.1:8888, restart unless-stopped; `searxng/settings.yml` git-ignored (secret). `.env` gained `SEARXNG_URL`; keys untouched (verified by length only).
- **Tests:** 42/42 (18 in `decisions.test.ts`). Tests disable `.env` via `BLACKHOLE_ENV_FILE=off` and point SearXNG at a closed port.
- **Incident:** my coverage probe (~70 queries in minutes) got Brave/Google/DDG to throttle this IP for ~3 min. Added the queue + explicit error. Do not run bulk probes against live engines again.
- **Real library:** backed up (`data/backups/blackhole-2026-10-25T07-51-07-166Z.sqlite`) before migration v2; RDR2 backfilled to PS4.
- **Next:** pin the SearXNG image by digest; consider a "Find trophies" action for games added before lookups existed (RDR2 has none yet — Refresh will propose values for review).

## Update — 2026-10-25: more SearXNG engines
- Owner hit the RATE_LIMITED message on RDR2 Refresh (expected after my probe burst). Enabled bing, google, qwant, yahoo in `searxng/settings.yml` (+ example); left Startpage/Mojeek off (PoW anti-bot). Restarted container; one query: bing 10 + yahoo 7 results.
- RDR2 (PS4) Refresh → NOT_FOUND: PST guide located, snippet has no numbers; UI shows the guide link for manual entry. Nothing applied.

## Update — 2026-10-25: guide page reading (owner-approved)
- New `adapters/guidepage.ts` (robots parser/cache, bot-check detection + 24 h host block, capped fetch, htmlToText, roadmapBox). `trophies.ts`: `matched` flag on candidates, page read fallback (≤2 pages), PowerPyx URL guess, h1 identity + publish-year checks, provenance "(guide roadmap)" vs "(search summary)".
- Tests 51/51 (`guidepage.test.ts`: extraction ignores scripts/comments, robots semantics, bot-check memory, URL guess identity check, predates-release rejection).
- Live: RDR2 (PS4) Refresh → NEEDS_REVIEW from PowerPyx roadmap: 240–300 h, 6/10, 1 playthrough, online yes, missables yes. Not applied — owner reviews and clicks Apply.
- PST + PSNProfiles return Cloudflare 403 to automated reads → not bypassed.

## Update — 2026-10-25: desktop shortcut + multi-select add
- Shortcut: `Desktop\Blackhole.lnk` → `scripts/launch-blackhole.vbs` → `launch-blackhole.ps1` (starts Docker/SearXNG + server if needed, opens Edge `--app`). Icon `assets/blackhole.ico` from `scripts/make-icon.ps1`. Fixed PS single-item array bug ($browsers[0] was "C"). Cold start verified.
- Multi-select in Add dialog (`AddModal.tsx`): checkbox per result + Select all, picks persist across searches within a type, per-game "Playing on" picker (PS5 default), sticky bar with chips + "Add N to the Pit", sequential adds with progress, failures stay ticked with reason. UI-only; typecheck + build OK.
- Verified at API level on staging (Dune 2021 / Part Two / Part Three added in sequence, runtime + director enriched, search marks them in the Pit). **Not clicked through in a browser** — Claude-in-Chrome extension was disconnected.

## Update — 2026-10-25: home page backlogs
- `Dashboard.tsx` rewritten: stat cards + 2×2 grid of Game/Movie/TV/Book backlog panels, 5 slots each via `backlogSlots` (IN_PROGRESS by updated_at desc, then PLANNED/PAUSED by created_at desc; COMPLETED/DROPPED excluded), "+ N more" link, View all, + Add. Continue shelf removed (in-progress items now lead each panel with a Playing/Watching/Reading pill).
- Test `tests/unit/dashboard.test.ts`; suite 52/52. Typecheck + build OK. Not visually verified (Chrome extension disconnected).

## Update — 2026-10-25: IMDb episode ratings (D-03 revised)
- **Ticket:** owner: TVmaze heatmap ratings not accurate, use IMDb. Branch `feat/imdb-episode-ratings` (uncommitted, awaiting owner).
- **Changes:** `adapters/imdb.ts` (dataset download via new `downloadFile` in `http.ts` — temp file + rename, If-Modified-Since, stale copy kept when offline; streamed gunzip parse filtered to linked shows; serialised queue; hourly job skips re-parse unless datasets/linked shows changed), `tvmaze.ts` `showImdbId`, `library.ts loadSeasons` picks one provider per show (IMDB > TVMAZE) and attribution, routes: add (background) + `/api/tv/:id/sync` (awaited) link IMDb ID and refresh ratings, `tvjob.ts` backfills IMDb IDs for existing shows and refreshes ratings (signature now takes `dataDir`), migration v3 (IMDB registry row). Host allowlist + `datasets.imdbws.com`.
- **Tests:** 54/54 (new `tests/unit/imdb.test.ts`: season/episode matching, `\N` rows ignored, unrated IMDb episode shows unavailable rather than TVmaze, unchanged datasets not re-downloaded/re-parsed, TVmaze fallback). `tsc` clean.
- **Live check (staging 4318, deleted):** Breaking Bad add+sync ≈9.5 s including first ~64 MB download; all 62 episodes rated; S5 values match the raw dataset exactly (e.g. S5E14 9.5 / 510k votes — the dataset value, not necessarily the website's display).
- **Limitations:** matching is by season/episode number, so shows where TVmaze and IMDb number episodes differently (split two-parters, anthology seasons) can be shifted; specials get no IMDb rating. First run after restart re-parses once (~5–10 s, background).
- **Next:** owner restarts the app (no web rebuild needed); consider per-show "rating source" override if a numbering mismatch shows up.

## Update — 2026-10-25: movie ratings (D-09), dashboard spacing, IMDb live
- **Why the heatmap still showed TVmaze:** the running server predated the change. Backed up (`data/backups/blackhole-2026-10-25T09-47-12-593Z.sqlite`), restarted 13:47; startup job linked IMDb IDs and rated True Detective 30/30, Sopranos 86/86 from IMDb.
- **Movies:** migration v3 (still unapplied anywhere before today) gained `media_ratings` + ROTTEN_TOMATOES registry row. `adapters/rottentomatoes.ts` (slug guess → SearXNG fallback, title/year check, `audienceScore` JSON), `services/movies.ts` (refresh, preview with 1 h cache, hourly backfill capped at 10 RT reads), `imdb.ts` handles MOVIE links + `imdbTitleRating`; TMDb detail now returns `imdb_id`. Routes: add waits ≤15 s for ratings; `POST /api/movies/:id/ratings/refresh`; `GET /api/movies/preview-ratings?tmdb=`. `tvjob.ts` → `runMaintenance` (TV, movies, one IMDb pass).
- **UI:** `MovieRatingBadges` (Bits), Add dialog preview for ticked movies, Ratings column + IMDb ≥ / RT audience ≥ filters (with "Include unrated") + sorts in Movies, Inspector RATINGS section with Refresh, dashboard movie rows. Dashboard spacing: `.dashboard` had no rule (stat cards touched backlog panels) → flex column gap 24px; grid gaps 20–24px; main padding 20/24.
- **Tests:** 58/58 (`movies.test.ts`: slugs, RT title/year/score parsing, add stores both ratings, preview stores nothing). `tsc` + `npm run build` clean.
- **Live:** staging: Dune Part Two IMDb 8.4 / RT 95%, Matrix 8.7 / 85%. Real library: Dune 8.0/90%, Part Two 8.4/95%, Clayface 7.6/94%; Dune Part Three unreleased → unavailable.
- **Not done:** nothing committed (branch `feat/imdb-episode-ratings`). Chrome extension wasn't connected; visual check used headless Edge on staging.
