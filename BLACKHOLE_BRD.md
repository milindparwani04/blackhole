# BLACKHOLE — BUSINESS REQUIREMENTS DOCUMENT (BRD)

**Version:** 1.0 draft for owner review  
**Date:** 25/10/2026  
**Status:** Implementation planning; unresolved decisions marked `DECISION REQUIRED`  
**Audience:** Product owner, Claude Code/VS Code coding agents, engineering and QA  
**Related:** `BLACKHOLE_PRD.md`, `BLACKHOLE_THREE_AGENT_CONSOLIDATED_RESEARCH.md`

## 0. Agent briefing (read first)
Blackhole is a local-first, game-first personal media backlog and discovery application for **games, movies, TV shows and books**. A user searches, chooses a correctly identified title and clicks **Add to the Pit**. Blackhole enriches available metadata and keeps personal notes, progress, completion history and imported records on the user's computer. Game detail pages emphasise completion-hour categories and PlayStation Platinum difficulty/time; TV details include a season-by-episode ratings heatmap and individual watched toggles. **Never fabricate unavailable data or silently overwrite user edits.**

This BRD describes **why and what** to deliver. The PRD describes **how, in which order, and how to prove completion**. No coding agent is authorised to improvise an unresolved product decision; create a blocking decision record, implement only unrelated work, and ask the owner.

## 1. Evidence, scope and decision provenance
- **R — Three-agent consensus:** local-first four-domain app; games first; IGDB, TMDb, TVmaze, Open Library, Google Books; Letterboxd ZIP/CSV imports; local React/Node/TypeScript/SQLite; provenance and safe fallback.
- **U — Owner decisions after consolidation:** preferred automatic search-based Platinum lookup on add; manual `Refresh Trophy Data`; show watch/progress/completion controls across media; TV season → episode tracking and ratings heatmap inspired by provided image.
- **E — Engineering proposals:** architecture details, schema, test gates and safeguards. These require verification and do not constitute independent market facts.
- **V — Independently documented:** official sources listed in Appendix A. Agreement among agents is not a substitute for empirical validation or licensing approval.

Research is not a legal clearance or a guarantee of provider access. The most material change from the original report is **user preference for automated trophy-search enrichment**, subject to a Phase 0 search/licensing/reliability proof. The old manual-only assumption is superseded as a target experience but preserved as a fallback.

## 2. Business problem and intended value
Users maintain fragmented watchlists, game wishlists, book lists and manually tracked completion states. Blackhole centralises title discovery, time commitment, PS trophy effort, progress and upcoming releases in one visually coherent local library.

**Primary outcomes:** (1) add a relevant title with minimal manual work, (2) choose what to play/watch/read based on transparent time and completion metrics, (3) track exact progress and finished works, (4) understand series/episode quality without conflating public ratings and personal progress, (5) retain ownership and portability of library data.

## 3. Users and usage assumptions
**Primary persona:** single desktop user maintaining a private library on their own computer. **Secondary/future:** more devices, LAN, accounts and hosted multi-user access are **not assumed**. Build for offline use of saved records, remote network access only for metadata lookup, and accessible keyboard/mouse interaction.

**Explicit product constraints:** games take precedence; four media categories supported; status/progress editable; no requirement for PSN account sign-in or automatic trophy-earned synchronisation at MVP; no provider's proprietary score may be labelled as another provider's score.

## 4. Scope and business requirements
| ID | Priority | Requirement | Acceptance from user's viewpoint | Provenance |
|---|---|---|---|---|
| BR-01 | Must | Central catalogue and user library for four media types | Can find/add, edit, remove or archive each type and restore saved state after restart | R |
| BR-02 | Must | Search, disambiguation and one-step Add to the Pit | Same-name titles, editions and platform variants are distinguishable; partial enrichment does not prevent saving | R |
| BR-03 | Must | User progress lifecycle: Planned, In Progress, Paused, Completed, Dropped | Status buttons work; changes persist; undo/reopen is possible; completion timestamps are retained | R+U |
| BR-04 | Must | Games: playtime and trophy guide information | Story/normal/completionist durations separate from Platinum hours; unknowns explicit | R |
| BR-05 | Must, proof-gated | Automatically attempt web-search-based trophy enrichment when adding PlayStation game | Correct game/stack, sourced difficulty and hours, other guide fields; safe failure fallback | U |
| BR-06 | Must | Manual trophy refresh and overrides | Refresh never removes notes, personal completion or locked overrides; user can see changes and provenance | U |
| BR-07 | Must | TV show → season → episode hierarchy | Mark individual episodes watched (including out of order); season/show progress calculated, completion controls consistent | U |
| BR-08 | Must | TV ratings heatmap by season and episode | Each cell maps to exact season/episode, shows sourced rating or N/A; clicking opens episode details | U |
| BR-09 | Must | Movies: watch status, rating and Letterboxd import | Personal rating not inferred from public rating; import preserves existing edits | R+U |
| BR-10 | Must | Books: edition pages, progress and series | Edition page count and book-series count handled distinctly; finish volume does not finish ongoing series | R+U |
| BR-11 | Should | Release discovery and reminder-free calendar | Announced future items sorted by date, undated TBA separated, region/platform labelled | R |
| BR-12 | Must | Ownership, safety and portability | Offline saved library works; exports/backups/restore validated; no telemetry default | R/E |
| BR-13 | Must | Information integrity | Sources, timestamps, unknown/estimated markers and manual locks visible where relevant | R |
| BR-14 | Must | Secure engineering and releases | Main protected, reviewed PRs only, CI/staging/security gates before releases | U/E |

## 5. Key user journeys
**J1 — Add game:** search → review edition/platform → add → persist immediate base item → try official game metadata → run permitted search-based trophy lookup for matching PS trophy stack → display source-linked fields, confidence and verification date → allow manual edit. Failure at any external step must not lose the library item.

**J2 — Refresh trophy:** open game → click `Refresh Trophy Data` → see candidate source and diffs → confirm overwrites of automatically sourced fields; preserve `user_locked` and progress; retain prior snapshot and permit reverting.

**J3 — Track show:** choose series → see seasons, number released and watched → choose season → toggle any episode → progress recomputes; complete season/show actions bulk-toggle eligible episodes with an undo affordance. New episodes do **not** retroactively erase previously recorded season-completion events.

**J4 — Explore heatmap:** select show → ratings grid with S1...SN columns and E1...EM rows, empty cells for nonexistent episodes, rating-source legend, unknowns distinct; click cell → episode title/date/runtime/synopsis/community rating/watched flag. Ratings heatmap and personal progress view are distinct modes.

**J5 — Complete media:** movie Mark Watched; book Mark Finished; game Story Completed and Platinum Earned as different fields; show episode/season/series completion. Dates are captured; user can undo. Completion flows must be consistent with status filters and dashboards.

**J6 — Letterboxd:** choose export ZIP/CSV → preview counts, watchlist/watched/ratings/diary distinctions → resolve ambiguous titles → commit atomic import → receive receipt and rollback option.

**J7 — Book series:** add work/edition → record selected edition's pages and progress → show series order and upcoming volume with date confidence/source.

## 6. Success measures and operating criteria (targets, not measured outcomes)
| Metric | Proposed acceptance target | Method |
|---|---|---|
| Core data durability | 0 lost entries across restart + representative restore drill | Automated and manual recovery tests |
| Import duplicate safety | 0 duplicates after exact re-import fixture | Integration test |
| Core task flow | Search/add/edit/complete/undo for every medium successful | Browser E2E |
| Progress arithmetic | Correct on season boundaries, special episodes, out-of-order viewing and newly aired episodes | Deterministic unit tests |
| Transparency | 100% external ratings/trophy values have provider label and captured-at date (or clear manual label) | Data validation/QA |
| Secure delivery | All required branch checks green and security findings resolved/explicitly risk-accepted | CI/PR controls |
| Accessibility | Target WCAG 2.2 AA for core flows, verified through automated and manual testing | Audit |

No unsupported numeric API availability or scrape coverage guarantees are promised. Search accuracy and performance SLOs shall be set after Phase 0 fixtures.

## 7. Non-functional business requirements
- **Privacy:** local on-disk user records; no marketing telemetry by default; imports process on local API; no secrets in browser or logs.
- **Availability:** viewing/editing saved content and progress remains possible without internet; upstream outages degrade only enrichment.
- **Data integrity:** local unique IDs, source IDs, idempotent import, transactional writes, backups with restore exercise, migrations.
- **Security:** OWASP ASVS 5.0.0 Level 2 **target for applicable controls**, documented applicability and verified tests; threat model includes browser-to-loopback attacks, ZIP/CSV abuse, search-result prompt/HTML injection, SSRF, supply-chain and secrets.
- **Performance:** UI responsive at target dataset size, benchmark after actual prototypes; no fabricated SLA.
- **Access:** keyboard navigation, text alternatives and grid screen-reader fallback; reduced motion, mobile/tablet responsive if approved.
- **Governance:** enforced PR-only merges, dedicated staging/test configuration, tagged releases, rollback; independent per-agent handoff on every task.

## 8. Dependencies and risks
| Risk | Business impact | Required response |
|---|---|---|
| Google or another search mechanism lacks stable licensed programmatic access | Trophy auto-enrichment fails | Phase 0 compare permitted search approaches; fall back to guide link/manual values; **do not bypass anti-bot controls** |
| Guide search yields wrong edition/platform/patch | Misleading effort decisions | Match title/year/stack/region; provenance/confidence; review uncertain cases |
| Episode rating source unavailable | Heatmap empty/misleading | Test source access/licence; show unavailable values; never invent |
| Provider rights change on public/commercial deployment | Compliance and launch risk | Per-source rights register and release gate |
| Release dates and episode counts change | Progress metrics confusing | Versioned metadata; preserve event history; distinguish aired/unreleased |
| Import/restore corrupts local records | Personal data loss | Preview + transaction + automated backup + restore verification |
| Local UI accidentally exposed to network | Security/privacy risk | Bind loopback, block hostile origins, explicit separate review before LAN |

## 9. Project governance, approval and responsibilities
**Owner:** sets unresolved business decisions, approves scope and release gates. **Coding agent:** implements only approved tickets and tests; documents design and deviations. **Review agent:** checks security, tests, source licences and architecture without self-approving work. **Release agent/human:** authorises merge and release after staging evidence.

**Definition of ready:** requirement ID, acceptance examples, source/rights constraints, fixtures, affected schema/API, tests, rollback. **Definition of done:** reviewed PR, green CI, E2E where user-facing, documentation, handoff, no open high-severity security findings, owner sign-off on product changes.

## 10. Chronological business phases
| Phase | Business objective and why (1–2 lines) | Gate |
|---|---|---|
| 0. Decisions & feasibility | Remove external-data and permission surprises before building dependencies. | Written rights/source decisions and working trophy/episode-rating proof or explicit fallback |
| 1. Secure local foundation | Establish safe persistence and merge standards before user data exists. | App starts on localhost; DB migrations, CI, protected main |
| 2. Four-media library | Deliver tangible user value independent of outside APIs. | CRUD/status/backup/restore for all types |
| 3. Search and identity | Make Add to the Pit practical without creating duplicates. | Provider fixtures; matching review; offline manual add |
| 4. Flagship games | Deliver playtime, trophy cards, auto-enrichment attempt and refresh. | Correct stack/source/locked fields; failure-safe tests |
| 5. TV seasons and episodes | Make the requested granular watch-tracker reliable. | Episode toggles, bulk completion, arithmetic, date handling |
| 6. TV ratings heatmap | Add the visual ratings overview without sacrificing access or provenance. | Responsive grid, keyboard/fallback list, source/unknown semantics |
| 7. Movies and Letterboxd | Reduce entry effort while protecting imported watch history. | Safe, repeatable ZIP/CSV import with rollback |
| 8. Books and series | Cover reading progress and edition-specific facts. | Edition fixture, series updates, tentative release dates |
| 9. Calendar & dashboard | Unify discovery and ongoing media across four silos. | Correct dates, progress sections and relevant filters |
| 10. Hardening & release | Verify security, portability, accessibility and recovery. | Full regression, staging sign-off, release and rollback drill |

## 11. Decisions requiring owner clarification (do not silently assume)
1. **D-01 Deployment:** strictly private Windows localhost now, or planned LAN/public/multiuser/commercial release? Determines auth, licensing and packaging.
2. **D-02 Trophy search:** which allowed search service and credentials/budget are acceptable? Google-like search *experience* is agreed, but an unrestricted production search API is not established.
3. **D-03 TV episode rating source:** is a legitimate available source such as a licensed API acceptable if it differs from Series Graph's ratings? Is manual entry/link-out acceptable if no approved feed exists?
4. **D-04 Progress policy:** when all *currently released* episodes are watched, should series automatically enter Completed or only suggest it? What happens on a newly released season?
5. **D-05 Platform scope:** PS5/PS4 first, and is a separate trophy stack per region/platform desired? Proposed schema supports it, but prioritisation needs approval.
6. **D-06 Letterboxd import:** import watched history as Completed by default, or ask via wizard? Both are implementable.
7. **D-07 Game playtime:** must completionist duration come from IGDB where present, a user-entered HLTB estimate, or selected source priority?
8. **D-08 Visual branding:** final colour palette/logo/animation not unanimously established and not yet signed off.

**Handling rule:** these are approval gates for affected features, not a reason to stall unrelated scaffold, CRUD or tests.

## Appendix A. Independent primary documentation
- IGDB API: https://api-docs.igdb.com/
- TMDb FAQ/licensing: https://developer.themoviedb.org/docs/faq
- TVmaze API/licensing: https://www.tvmaze.com/api
- Letterboxd export help: https://support.letterboxd.com/hc/en-us/articles/15178580060701-How-do-I-export-my-data-
- Open Library API: https://openlibrary.org/developers/api
- Google Books volume API: https://developers.google.com/books/docs/v1/reference/volumes
- OWASP ASVS 5.0: https://asvs.owasp.org/
- OWASP WSTG: https://wstg.owasp.org/latest/
- GitHub branch protections: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

## Appendix B. Source discipline
See the three-agent consolidated research file for overlapping/disputed claims and original reports. The TV heatmap layout and automatic search-triggered Platinum enrichment were **added through later owner conversations**, not claimed as consensus in the original research. All performance targets and tooling choices in these documents are proposed engineering constraints, not externally measured benchmarks.
