# BLACKHOLE — STRICT THREE-AGENT CONSOLIDATED RESEARCH REPORT

**Date:** 25 October 2026  
**Purpose:** Consolidate independent reports through a strict 3-of-3 agreement filter, distinguish external verification from consensus, and preserve disputed findings without upgrading them to product requirements.  
**Sources:** [A] `BLACKHOLE_INDEPENDENT_RESEARCH_REPORT(1).md`; [B] `blackhole_master_research_technical_report.md`; [C] `Blackhole — Feasibility Research Report.md`.  
**Status:** Research consolidation, **not** an approved BRD, PRD, licence clearance, or implementation instruction.

## 1. Executive conclusion

The three reports converge on a feasible **local-first personal backlog application for Games, Movies, TV Shows and Books**. They recommend a **games-first** implementation using a local TypeScript/Node backend, React interface and SQLite persistence. The core product is an **in-app search → select or add manually → save to personal library** workflow. Durable entries, identifiers, progress and user adjustments must remain usable if upstream providers are unavailable.

All three distinguish common metadata obtainable through documented services from proprietary/restricted enrichment. They agree that the MVP **must not assume automatic HowLongToBeat, PSNProfiles or PowerPyx ingestion**, and must instead support user-entered playtime and Platinum estimates accompanied by source links. They also agree that Letterboxd **account ZIP/CSV export** provides a workable personal import mechanism, while unrestricted live API access must not be assumed. Movie/TV metadata can rely on TMDb, TV episode details may be supplemented with TVmaze, and books can draw on Open Library and Google Books. Provenance, identity disambiguation, version-specific fields, safe imports, local backups and security controls are essential.

**Important:** The three-agent intersection is a filter on the reports, not proof that a claim is correct. External checks listed here were desk checks of original documentation. No authenticated provider testing, real account ZIP parsing, source permissions, or licence review by counsel was completed.

## 2. Method and evidence rules

- **Retained:** the narrow *underlying proposition* is supported in all three reports, even if a report provides less detail. A stronger specific claim is not retained merely because weaker reports do not contradict it.
- **Verification:** original provider documentation is cited when independently inspected; otherwise the conclusion is identified as three-agent agreement only, or an engineering recommendation rather than an external fact.
- **Excluded:** if one report alone supplies a provider, specification, metric or policy, do not promote it to consensus. If an agent contradicts another, isolate the conflict.
- **Unproven:** an endpoint's existence is not proof of field coverage, right to redistribute, reliability, accuracy or suitability for Blackhole's terms of use.

## 3. Consensus matrix

| Area | Narrow claim supported by A + B + C | External verification / boundary | Disposition |
|---|---|---|---|
| Product | Four-domain local-first personal library, prioritising games | Product/engineering recommendation | Retain |
| Core UX | Search and add title, personal statuses/progress/notes; manual fallback | Engineering consensus | Retain |
| Game catalog | IGDB as principal candidate for game identity, covers, release dates, genres, platforms | [P1] official API; credentials needed | Retain |
| IGDB rights | Free noncommercial API access; commercial arrangements require separate consideration | [P1] explicit free-for-noncommercial language and commercial partnership | Retain narrow statement; reject blanket 'free commercial' |
| Playtime | HLTB has no *established official public* API path fit for assumed integration; manual provenance-based fallback | No provider authorisation granted; absolute claim of *no API whatsoever* is too broad | Retain narrow statement |
| Trophy guides | PSNProfiles/PowerPyx have guide data but approved bulk/programmatic extraction is not established for the project | Public guide visibility does not confer reuse rights; PSNProfiles terms page returned 403 during verification | Retain with legal caution |
| Platinum | Hours, difficulty, online/missable, playthrough conditions tracked separately from game completion time | Author estimates vary by guide/stack | Retain |
| Movie/TV | TMDb official API candidate for films, series, posters, cast and duration | [P2] licensing and attribution confirmed | Retain |
| TV episodes | TVmaze useful supplement for seasons, episodes, scheduling | [P3] API and CC BY-SA documented | Retain |
| Ratings | Personal Letterboxd score, TMDb score, RT audience and Letterboxd community scores are distinct | No approved general audience/community rating feed demonstrated | Retain |
| Letterboxd | Own ZIP/CSV account export over assumed live API; separate watched, ratings and watchlist | [P4] official export docs; actual headers untested | Retain |
| Book records | Open Library plus Google Books; separate works and editions, edition-specific pages | [P5,P6] docs show work/edition and pageCount | Retain |
| Book series | Model series and ordering separately; future volume needs publisher/source check and manual editing | Universal reliable series/date feed not established | Retain |
| Data identity | Canonical local IDs + provider mappings; avoid merging on title alone | Engineering consensus | Retain |
| Provenance | Source, original ID/URL, observation/verification time and manual override status for enriched fields | Engineering consensus | Retain |
| Releases | Distinguish announced/tentative/TBA dates, regional/platform differences, and date changes | Engineering consensus | Retain |
| Architecture | React + Node/TypeScript local API + SQLite, one local deployment | Strong common recommendation, not performance benchmark | Retain |
| Secrets | Provider credentials server-side; localhost default | Security consensus | Retain |
| Reliability | Offline edits, safe caching/refresh, recoverable failures, import preview, backup/restore | Engineering consensus | Retain |
| Delivery | Phased milestones, tests, security review, accessibility, no feature built on unapproved scraping | Strong common principle; exact phase numbering differs | Retain principle only |

## 4. Consolidated product and data strategy

### 4.1 Games — flagship

Use IGDB for search, disambiguation, metadata and platform/date information. Distinguish the base game from DLC, remasters, editions and separate platform releases. Store **gameplay duration** independently from **Platinum completion duration**; a completionist estimate is not a Platinum estimate. Support separately-labelled quick/story, main + extras and completionist values **only when the selected source's field semantics actually match**; show `Unknown` rather than implying missing values are zero. The MVP must permit manual hours entry linked to a source and date.

For PlayStation-specific trophies, support **Yes / No / Unknown / Not applicable** for Platinum availability; difficulty, range of required hours, minimum playthroughs, online trophies, missables, unobtainable flags, a specific PS4/PS5/region trophy stack and guide link. Multiple guides may disagree: display source-specific values rather than silently averaging them. Do not auto-collect from PSNProfiles or PowerPyx without confirmed permission and a technical/accuracy audit. A user can open an original guide and enter values.

### 4.2 Movies and TV

Use TMDb as the primary movie/TV candidate, with TVmaze as a complementary episode/schedule provider. Show title, synopsis, posters, release data, genres, cast and film runtime. TV hours should be calculated from **released episodes' actual available runtimes**, with any average-runtime substitution visibly labelled an estimate; specials and unreleased episodes must not be accidentally counted as already available to watch.

Keep the following different concepts separate: **my Letterboxd rating**, **Letterboxd community rating**, **TMDb community vote**, **Rotten Tomatoes audience score** and **Rotten Tomatoes critic score**. Lack of a licensed source should show `Not available` or a source link, not an invented or relabelled value. Official TMDb documentation requires attribution and the prescribed acknowledgement for a noncommercial app [P2]. TVmaze requires compliance with CC BY-SA attribution/share-alike where its data is used [P3].

### 4.3 Letterboxd import

Build **select user ZIP/CSV → validate archive → classify watchlist/watched/diary/ratings → resolve identities → dry-run preview → transaction commit → import receipt**. Official Letterboxd documentation confirms a ZIP of CSV account records [P4]. The reports agree on distinct semantics: a watchlist record is not proof a movie was watched; a personal rating exists only where supplied; viewing/diary events are separate history. Match using any available stable external IDs, otherwise title/year review. Retain external Letterboxd URI mapping if supplied. Import repetition should not create duplicate library records, and manual edits should not be silently overwritten. Test the actual export shape before fixing exact column names or immutable deduplication rules.

### 4.4 Books and series

Use **Open Library** for book discovery, works/editions/ISBN metadata and **Google Books** as a complement for synopsis and edition metadata. Store page counts on a **selected edition**, not as universal properties of a work. Represent books, editions, series, sequence and membership separately. For a next instalment, record *published*, *announced*, *date TBA*, *tentative*, *delayed* or *unannounced*, alongside publisher/author source URL, checked time and locale/date precision. Do not turn reader theories or placeholder retail dates into confirmed publication announcements.

### 4.5 Search, backlog, calendar and UX

Core navigation covers Games, Movies, TV, Books and a cross-category adding/search workflow, plus a release calendar and data management. Search returns recognisable metadata and enough year/platform/edition context to prevent wrong matches. Clicking **Add to the Pit** creates a local entry even when optional enrichment fails. Users can edit statuses, ownership, priority, progress, personal ratings and notes. Display TBA items outside date-fixed calendar slots. Shared dark/cinematic terminal-style design is a thematic preference common to the reports, **not** consensus on one exact palette, logo, font stack or layout.

## 5. Consolidated engineering architecture

```text
Local React user interface
     |  search / add / update / import / calendar
     v
Local Node.js + TypeScript API (loopback by default)
     |--- official provider adapters and controlled credentials
     |--- identity reconciliation / source provenance / refresh cache
     |--- safe ZIP/CSV importer and import receipts
     |--- user data CRUD, release events, backup/restore
     v
SQLite
  media catalogue + provider identifiers
  platform/edition/season/episode/series details
  personal library and progress
  source-attributed time, trophy and ratings records
  release events + import/change history
```

This is a consensus **architectural recommendation**, not a benchmarked guarantee that Node/React/SQLite are optimal. Preserve canonical catalogue objects separately from personal tracking entries. Provider records carry unique provider/type/ID mappings; game platform/trophy stacks and book editions have their own identities. Fields that come from third parties should carry a provenance record and allow a user override that survives refresh.

Security baseline shared across reports: secrets outside source control and inaccessible to the browser; localhost binding by default; parametrised SQL and validated input; allowlisted or disabled arbitrary external fetching; cautious third-party HTML rendering; archive member/size/path and decompression checks; CSV formula protection on future exports; import previews and transactional rollbacks; restore-tested backups; protected main branch and CI including unit, integration and end-to-end tests. Any future LAN or cloud exposure is a separate threat-model and authentication decision. Compliance with **OWASP** and accessibility standards must be tested, never presumed from a component/library choice.

## 6. What does NOT meet the three-report unanimity threshold

| Claim / proposal | Reason excluded from baseline | Research treatment |
|---|---|---|
| **IGDB automatic `game_time_to_beats` as MVP default** | C describes it; A/B recommend manual/other routes rather than this endpoint | **Independent discovery confirmed:** official endpoint exists [P1]. Coverage, permission for specific deployment and sample results remain untested. Keep as a *new validated opportunity*, not retroactive 3/3 consensus. |
| **IGDB is free for any commercial project without a partnership** | A describes commercial access broadly, B/C restrict free use to noncommercial | Official docs [P1] distinguish free noncommercial API from commercial partnerships. Do not assume free commercial rights. |
| **RAWG as a mandated fallback** | Not a substantive common recommendation across all three | Candidate for optional evaluation, not in approved baseline |
| **Hardcover as mandatory book-series API** | C recommends it; A/B do not establish it as consensus | Candidate for separate source/licence/coverage test |
| **Exact rates and quotas for every provider** | Not consistently covered, and can change | Use provider-specific config; verify limits in implementation phase |
| **A particular UI hex palette, font, logo and exact keyboard shortcut** | B more prescriptive than A/C | Require design exploration and accessibility checks; no preapproved theme |
| **Fastify, Express, Hono, `better-sqlite3`, WAL, FTS5, precise port, framework/library versions** | Different levels of specificity or alternatives | Implementation choices; validate on target OS before standardising |
| **Automatic PSN profile/trophy sync** | Optional post-MVP speculation, not supported/permissioned universally | Exclude from baseline; separate risk/permission assessment |
| **Automated community/static dataset ingestion of playtime or trophies** | Origin, redistribution rights and reliability not unanimously established | Disabled absent licence and provenance audit |
| **Fixed numeric speed targets or API coverage guarantees** | Agent-specific hypotheses, no benchmark tests | Turn into future test acceptance criteria, not asserted performance |
| **“Phase 0 gates already passed”** | Reports disclose untested exports, no authenticated samples and unsettled licences | **Reject**; pre-build verification gates remain open |
| **No legal issues because it is personal/local** | Incorrect inference from deployment scope | Provider terms still apply; document rights and attribution |
| **Automatic universal forthcoming-book publication date feed** | No unanimous evidence for an authoritative comprehensive endpoint | Manually verified publisher/author announcements |

**Notable reconciliation:** the direct inspection of [IGDB official docs][P1] confirms `game_time_to_beats` exposes `hastily`, `normally`, `completely`, `count`, and `game_id` and defines the durations in seconds. This factual finding improves project feasibility, **but stays separate from the strict intersection report** because it was not a shared conclusion. Before adoption, test a representative backlog sample and preserve its own descriptions (rushed, normal, complete) instead of calling them HLTB Main/Main+Extras/Completionist by default.

## 7. Consolidated risks and gates

| Risk | Why it matters | Required gate |
|---|---|---|
| Trophy data has no confirmed permitted structured feed | Flagship filters otherwise show missing values | Approval or reliable manual-guide workflow, using realistic title sample |
| Playtime is sparse or source labels differ | Hours filters become misleading | Test sample coverage; label provider definitions; preserve Unknown |
| Community scores lack licences | Wrongly attributed or unavailable ratings | Distinct fields; verified permission or explicit unavailable state |
| Letterboxd parser merges wrong entries | Data corruption and watched/watchlist confusion | Real/synthetic ZIP test, conflict screen, idempotent reimport, rollback |
| Game editions / trophy stacks collide | Wrong difficulty, date or Platinum status | Provider IDs and stack-specific test cases |
| Book editions / announcements collide | Wrong pages and speculative dates | Edition selection, publisher references, status history |
| Provider terms / quotas shift | Product unusable or noncompliant | Versioned provider registry, per-provider checks and manual fallback |
| Local corruption / insecure imports | Lost personal data or local compromise | Restore drill, bounded ZIP extraction, hostile-input tests, CI |
| Four-category scope dilutes game-first aim | Flagship work delayed | Deliver thin personal library then game vertical slice |

**Common staged delivery logic (exact phase numbering intentionally not retained):**

1. Verify access/rights and define source fallbacks; test ambiguous game/trophy examples.
2. Establish local runtime, database migrations, backups, permissions registry and test pipeline.
3. Implement all-category manual CRUD plus global search/Add to the Pit with identity review.
4. Build the game-first platform, gameplay time and manual source-linked trophy workflows.
5. Add TMDb/TVmaze media details and correct released-episode duration accounting.
6. Add Letterboxd safe import with preview, repeat-import and rollback tests.
7. Add work/edition book structures, series curation and source-backed next-book dates.
8. Add release timeline, responsive and keyboard accessibility, provider failure handling and security/restore acceptance tests.

These are ordered **research recommendations**, not approved engineering requirements or proof of completion.

## 8. Outstanding owner decisions and verification experiments

**Owner choices common to the reports:** (a) private/noncommercial indefinitely or possible public/commercial release; (b) acceptance of manually curated Platinum hours and difficulty with guide URLs; (c) priority platforms and treatment of separate editions/stacks; (d) watchlist-only versus full Letterboxd watched/rated history import; (e) whether unconfirmed-but-sourced projected releases appear; (f) whether later LAN/PSN integrations are even in scope.

**Uncompleted experiments:** authenticated IGDB sample data and playtime coverage; representative manual trophy-guide source review and permissions; one actual Letterboxd ZIP mapping with malicious-fixture tests; TV specials/air dates/duration sample checks; book edition and series publication source audit; Windows installation and restore; accessibility review. Agent estimates or suggested speed targets are not test results.

## 9. Evidence bank — original-source links checked in this consolidation

**[P1] IGDB official API documentation:** https://api-docs.igdb.com/  
- Relevant sections: Getting Started → Account Creation, Authentication, Rate Limits; Endpoints → Game Time To Beat; Partnership.  
- Direct evidence: Twitch client credentials, explicitly free noncommercial use, commercial partnership availability; game time endpoint and field meanings.  
- Limitations: does not demonstrate actual catalogue coverage or Blackhole-specific rights to retain/redistribute assets.

**[P2] TMDb official FAQ:** https://developer.themoviedb.org/docs/faq  
- Relevant sections: API key, free noncommercial use, commercial licensing and attribution.  
- Direct evidence: free noncommercial access with attribution, TMDb logo and prescribed credit.  
- Limitations: not a licence for Rotten Tomatoes audience or Letterboxd community values.

**[P3] TVmaze official API:** https://www.tvmaze.com/api  
- Relevant sections: Search, Episodes, Seasons, Schedules, Rate Limiting, Licensing.  
- Direct evidence: available show/episode endpoints and CC BY-SA obligations.  
- Limitations: data completeness/accuracy and licence interaction require project-specific diligence.

**[P4] Letterboxd official account export and FAQ:** https://letterboxd.com/user/exportdata/ and https://letterboxd.com/faq/  
- Relevant sections: Export your data; Data and privacy → copy of account data.  
- Direct evidence: user account export is a ZIP containing CSVs.  
- Limitations: exact columns and categories are not established until a real export fixture is inspected.

**[P5] Open Library official API and Works/Editions explanation:** https://openlibrary.org/developers/api and https://openlibrary.org/dev/docs/api/books  
- Relevant sections: Usage Guidelines, Rate Limits, Work vs Edition, search/edition APIs.  
- Direct evidence: JSON-based lookup interfaces and separate work/edition entities.  
- Limitations: library explicitly discourages operating it as bulk third-party infrastructure; incomplete series/edition data possible.

**[P6] Google Books API official Volume resource:** https://developers.google.com/books/docs/v1/reference/volumes  
- Relevant section: Volume resource `volumeInfo`.  
- Direct evidence: authors, descriptions, publishing metadata, `pageCount`, IDs.  
- Limitations: no validated comprehensive ordered-series / future-date feed.

**[P7] PSNProfiles guide site/terms:** https://psnprofiles.com/guides and https://psnprofiles.com/about/terms  
- The three reports converge that guides exist and unattended retrieval is not an approved Blackhole integration.  
- **Verification limitation:** direct independent terms retrieval returned HTTP 403. Specific TOS wording and scope have **not** been independently re-confirmed here. No script should bypass technical restrictions.

**[P8] PowerPyx website:** https://www.powerpyx.com/  
- Reports cite individual roadmaps with estimated hours, difficulty, missables and online requirements.  
- **Verification limitation:** existence of guide contents does not establish licensing for an automated data feed.

## 10. Final synthesis / rule for BRD and PRD

**Approved for further product planning based on 3/3 agreement:** local personal library; game-first build; searchable manual and official-metadata-based item creation; licensed-source candidate adapters (IGDB/TMDb/TVmaze/Open Library/Google Books); manual, verifiable Platinum and gameplay estimates; user-export Letterboxd import; explicit source provenance, unknown states, identity/edition/stack separation, local backups, staged security and testing.

**Not yet approved:** any unsupported scraping or reverse engineering, community score ingestion without licence, untested automatic gameplay time coverage, automatic PSN sync, exact implementation libraries or UI aesthetics, and statements that API/data access rights are already cleared.

**Research-only opportunity:** IGDB's officially documented game-time-to-beat endpoint could remove some manual work, subject to a focused coverage/terms proof-of-concept. Its existence is independently verified but not 3-agent consensus.

**Bottom line:** Blackhole can be built without taking dependency on unapproved data extraction. The crucial scope decision is whether manually linked Platinum fields are acceptable as the first iteration while official/provider-approved automation remains an explicit later research gate.
