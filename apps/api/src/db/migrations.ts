// Forward-only migrations. Never edit an applied migration; add a new one.
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'core library, games, tv, books',
    sql: `
CREATE TABLE media_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('GAME','MOVIE','TV','BOOK')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  year INTEGER,
  synopsis TEXT,
  cover_url TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  creator TEXT,
  runtime_min INTEGER,
  metadata_source TEXT NOT NULL DEFAULT 'MANUAL',
  source_url TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE external_ids (
  provider TEXT NOT NULL,
  object_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, object_type, external_id)
);

CREATE TABLE library_entries (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL UNIQUE REFERENCES media_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','IN_PROGRESS','PAUSED','COMPLETED','DROPPED')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  owned INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  personal_rating REAL CHECK (personal_rating IS NULL OR personal_rating BETWEEN 0 AND 10),
  current_page INTEGER CHECK (current_page IS NULL OR current_page >= 0),
  started_at TEXT,
  completed_at TEXT,
  story_completed_at TEXT,
  platinum_earned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE progress_events (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  undone_at TEXT,
  undo_of TEXT
);
CREATE INDEX idx_events_entry ON progress_events(entry_id, occurred_at);

CREATE TABLE game_time_estimates (
  media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('STORY','NORMAL','COMPLETIONIST')),
  hours REAL NOT NULL CHECK (hours >= 0),
  source TEXT,
  source_url TEXT,
  checked_at TEXT,
  user_locked INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (media_id, category)
);

CREATE TABLE trophy_guides (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('PS5','PS4','PS3','PSVITA')),
  region TEXT NOT NULL DEFAULT 'ALL',
  platinum TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (platinum IN ('YES','NO','UNKNOWN')),
  hours_min REAL CHECK (hours_min IS NULL OR hours_min >= 0),
  hours_max REAL CHECK (hours_max IS NULL OR hours_max >= 0),
  difficulty_min REAL CHECK (difficulty_min IS NULL OR difficulty_min BETWEEN 0 AND 10),
  difficulty_max REAL CHECK (difficulty_max IS NULL OR difficulty_max BETWEEN 0 AND 10),
  difficulty_text TEXT,
  playthroughs INTEGER,
  online_required INTEGER,
  missables INTEGER,
  guide_url TEXT,
  source TEXT,
  checked_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  user_locked INTEGER NOT NULL DEFAULT 1,
  UNIQUE (media_id, platform, region)
);

CREATE TABLE tv_seasons (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  is_special INTEGER NOT NULL DEFAULT 0,
  UNIQUE (media_id, number, is_special)
);

CREATE TABLE tv_episodes (
  id TEXT PRIMARY KEY,
  season_id TEXT NOT NULL REFERENCES tv_seasons(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT,
  airdate TEXT,
  runtime_min INTEGER,
  summary TEXT,
  UNIQUE (provider, provider_id)
);
CREATE INDEX idx_episodes_season ON tv_episodes(season_id, number);

CREATE TABLE episode_watch_states (
  entry_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL REFERENCES tv_episodes(id) ON DELETE CASCADE,
  watched INTEGER NOT NULL,
  watched_at TEXT,
  PRIMARY KEY (entry_id, episode_id)
);

CREATE TABLE episode_ratings (
  episode_id TEXT NOT NULL REFERENCES tv_episodes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  score REAL NOT NULL,
  scale REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (episode_id, provider)
);

CREATE TABLE book_editions (
  media_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  pages INTEGER CHECK (pages IS NULL OR pages > 0),
  isbn TEXT,
  format TEXT,
  pages_source TEXT
);

CREATE TABLE provider_registry (
  provider TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  permission_status TEXT NOT NULL,
  attribution TEXT,
  notes TEXT,
  last_reviewed TEXT
);

INSERT INTO provider_registry VALUES
  ('TVMAZE','TV search, seasons, episodes, episode ratings','ENABLED (CC BY-SA 4.0, attribution required)','Data from TVmaze.com, CC BY-SA 4.0',NULL,'2026-10-25'),
  ('OPENLIBRARY','Book search, works, cover images','ENABLED (open data, low-volume personal use)','Data from Open Library',NULL,'2026-10-25'),
  ('IGDB','Game search, platforms, time-to-beat','DISABLED: needs IGDB_CLIENT_ID/SECRET and D-07 decision',NULL,NULL,'2026-10-25'),
  ('TMDB','Movie search and metadata','DISABLED: needs TMDB_API_TOKEN',NULL,NULL,'2026-10-25'),
  ('TROPHY_SEARCH','Automatic Platinum guide lookup','DISABLED: blocked by D-02 (no permitted search provider)',NULL,NULL,'2026-10-25');

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
`,
  },
  {
    version: 2,
    name: 'owner decisions 2026-10-25: play platform, trophy lookup jobs',
    sql: `
-- D-05: only the version the owner intends to play is tracked for trophies.
ALTER TABLE library_entries ADD COLUMN play_platform TEXT;

-- D-02: SearXNG-backed trophy lookups, with the candidates, proposal and pre-apply snapshot kept for review/revert.
CREATE TABLE trophy_lookup_jobs (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('ADD','REFRESH','PLATFORM_CHANGE')),
  status TEXT NOT NULL CHECK (status IN ('RUNNING','FOUND','PARTIAL','NOT_FOUND','NEEDS_REVIEW','ERROR')),
  query TEXT,
  candidates TEXT NOT NULL DEFAULT '[]',
  proposal TEXT,
  previous TEXT,
  error TEXT,
  applied_at TEXT,
  reverted_at TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_trophy_jobs_entry ON trophy_lookup_jobs(entry_id, created_at);

UPDATE provider_registry SET capability = 'Game search, platforms, normal time-to-beat (D-07)' WHERE provider = 'IGDB';
DELETE FROM provider_registry WHERE provider = 'TROPHY_SEARCH';
INSERT INTO provider_registry VALUES
  ('SEARXNG','Trophy guide lookup (local metasearch; snippets from PowerPyx, PSNProfiles, PlayStationTrophies, Knoef)',
   'DISABLED: SearXNG not reachable', 'Guide values link back to the original guide', NULL, '2026-10-25');
`,
  },
];
