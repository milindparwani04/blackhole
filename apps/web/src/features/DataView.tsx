import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../context';
import { ImportPanel } from './ImportPanel';

// Owner decisions, 25/10/2026 (see docs/decisions/OPEN_QUESTIONS.md).
const DECISIONS = [
  ['D-01', 'Where it runs', 'This PC only (loopback); personal, non-commercial'],
  ['D-02', 'Trophy lookup', 'Local SearXNG; parses guide summaries from PowerPyx, PSNProfiles, PlayStationTrophies, Knoef'],
  ['D-03', 'Episode ratings', 'IMDb episode ratings only; none shown when IMDb has none'],
  ['D-04', 'TV completion', 'Completed when every aired episode is watched; back in the Pit when new episodes air'],
  ['D-05', 'Trophy versions', 'Only the version you play (PS5 default, PS4 for older games); no regions'],
  ['D-06', 'Imports', 'One-off Letterboxd (export or profile link) and Goodreads (CSV export) imports; revised 25/10/2026'],
  ['D-07', 'Game playtime', 'IGDB “normally” time; your own entries take priority'],
  ['D-08', 'Look & branding', 'Mockup theme approved; subtitle and tagline removed'],
];

type GuideId = 'IGDB' | 'TMDB' | 'SEARXNG';

const KEY_GUIDES: { id: GuideId; title: string; unlocks: string; vars: string[]; steps: (string | [string, string])[] }[] = [
  {
    id: 'IGDB',
    title: 'IGDB — game search',
    unlocks: 'Game search with covers, platforms, genres and developer',
    vars: ['IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET'],
    steps: [
      ['Sign in to the Twitch developer console (enable two-factor authentication on your Twitch account first — required)', 'https://dev.twitch.tv/console/apps'],
      'Register Your Application → Name: anything (e.g. “Blackhole Local”), OAuth Redirect URL: http://localhost, Category: Application Integration, Client Type: Confidential → Create',
      'Open Manage on the new app: copy the Client ID, then click New Secret and copy the Client Secret',
      'Paste both into IGDB_CLIENT_ID and IGDB_CLIENT_SECRET in the .env file in the Blackhole folder, then save',
    ],
  },
  {
    id: 'TMDB',
    title: 'TMDb — movie search',
    unlocks: 'Movie search with posters, synopsis, runtime and director',
    vars: ['TMDB_API_TOKEN'],
    steps: [
      ['Create a free TMDb account and sign in', 'https://www.themoviedb.org/signup'],
      ['Request an API key (choose Developer / personal use)', 'https://www.themoviedb.org/settings/api'],
      'Copy the “API Read Access Token” (the long one; the short “API Key” also works)',
      'Paste it into TMDB_API_TOKEN in the .env file in the Blackhole folder, then save',
    ],
  },
  {
    id: 'SEARXNG',
    title: 'SearXNG — trophy lookup',
    unlocks: 'Automatic Platinum hours, difficulty, playthroughs and missables when you add a PlayStation game',
    vars: ['SEARXNG_URL'],
    steps: [
      'Runs locally in Docker as the “blackhole-searxng” container on 127.0.0.1:8888 (already set up)',
      'Keep Docker Desktop running — the container restarts with it automatically',
      'Config lives in searxng/settings.yml in the Blackhole folder (JSON output on, rate limiter off, not exposed to your network)',
    ],
  },
];

function ApiKeys({ providers, onChange }: { providers: any[]; onChange: () => void }) {
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string } | 'testing'>>({});
  const test = async (id: GuideId) => {
    setResults((r) => ({ ...r, [id]: 'testing' }));
    try {
      const r = await api.testProvider(id);
      setResults((x) => ({ ...x, [id]: r }));
    } catch (e) {
      setResults((x) => ({ ...x, [id]: { ok: false, message: (e as ApiError).message } }));
    }
    onChange();
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h1 className="h-title">API KEYS &amp; SERVICES</h1>
        <button className="btn ghost sm" onClick={onChange}>
          ↻ Re-check
        </button>
      </div>
      <p className="muted sm">
        TV (TVmaze) and books (Open Library) need no keys. SearXNG runs on this PC. Keys are stored only in <code>.env</code> on this computer, read by the local server, and never sent to the browser or included in
        exports. Saving <code>.env</code> takes effect immediately — no restart needed.
      </p>
      <div className="key-grid">
        {KEY_GUIDES.map((g) => {
          const configured = providers.find((p) => p.provider === g.id)?.configured === true;
          const r = results[g.id];
          return (
            <div key={g.id} className="key-card">
              <div className="row between">
                <h2 className="h-section">{g.title}</h2>
                <span className={`pill ${configured ? 'good' : 'warn'}`}>{g.id === 'SEARXNG' ? (configured ? 'RUNNING' : 'NOT RUNNING') : configured ? 'KEY SET' : 'NOT SET'}</span>
              </div>
              <div className="muted sm">{g.unlocks}</div>
              <ol className="steps">
                {g.steps.map((s, i) => (
                  <li key={i}>
                    {Array.isArray(s) ? (
                      <a href={s[1]} target="_blank" rel="noopener noreferrer">
                        {s[0]} ↗
                      </a>
                    ) : (
                      s
                    )}
                  </li>
                ))}
              </ol>
              <div className="sm">
                Variables: {g.vars.map((v) => <code key={v}>{v} </code>)}
              </div>
              <div className="row gap wrap">
                <button className="btn primary sm" disabled={!configured || r === 'testing'} onClick={() => test(g.id)}>
                  {r === 'testing' ? 'Testing…' : 'Test connection'}
                </button>
                {r && r !== 'testing' && <span className={`sm ${r.ok ? 'ok-text' : 'err-text'}`}>{r.message}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="source-line">Both services are free for personal, non-commercial use. Commercial or public release needs separate licensing (D-01).</p>
    </section>
  );
}

export function DataView() {
  const { notify } = useApp();
  const [providers, setProviders] = useState<any[]>([]);
  const [backups, setBackups] = useState<{ file: string; bytes: number }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.providers().then(setProviders).catch(() => {});
    api.backups().then(setBackups).catch(() => {});
  };
  useEffect(load, []);

  return (
    <div className="stack-lg">
      <ApiKeys providers={providers} onChange={load} />
      <ImportPanel />
      <section className="panel">
        <div className="panel-head">
          <h1 className="h-title">DATA &amp; BACKUPS</h1>
        </div>
        <p className="muted sm">Your library lives in a single SQLite file on this computer. Backups are consistent snapshots in the data/backups folder. Exports are readable JSON and contain no API keys.</p>
        <div className="row gap wrap">
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.backup();
                notify(`Backup saved (${(r.bytes / 1024).toFixed(0)} KB)`);
                load();
              } catch (e) {
                notify((e as ApiError).message, { error: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Backing up…' : 'Create backup now'}
          </button>
          <a className="btn ghost" href="/api/export" download>
            Export library (JSON)
          </a>
        </div>
        {backups.length > 0 && (
          <ul className="plain-list">
            {backups.slice(0, 8).map((b) => (
              <li key={b.file}>
                <code>{b.file}</code> <span className="muted sm">{(b.bytes / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="h-section">SOURCE REGISTER</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Used for</th>
                <th>Status</th>
                <th>Attribution</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td className="sm">{p.capability}</td>
                  <td className="sm">
                    <span className={`pill ${p.permission_status.startsWith('ENABLED') ? 'good' : 'warn'}`}>{p.permission_status.split(' ')[0].replace(':', '')}</span> <span className="muted">{p.permission_status.replace(/^\w+:?\s*/, '')}</span>
                  </td>
                  <td className="sm muted">{p.attribution ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="source-line">
          TV data from <a href="https://www.tvmaze.com/" target="_blank" rel="noopener noreferrer">TVmaze</a> is licensed CC BY-SA 4.0. Book data from{' '}
          <a href="https://openlibrary.org/" target="_blank" rel="noopener noreferrer">
            Open Library
          </a>
          .
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="h-section">OWNER DECISIONS</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Topic</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {DECISIONS.map(([id, q, d]) => (
                <tr key={id}>
                  <td>{id}</td>
                  <td className="sm">{q}</td>
                  <td className="sm muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
