import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImportItem, ImportJob, Status } from '../../../../packages/shared/src/index';
import { api, ApiError, type AnilistEntry } from '../api';
import { useApp } from '../context';
import { Cover, StatusPill } from '../components/Bits';
import { STATUS_LABEL } from '../format';
import { Progress } from './LibraryView';

type Filter = 'ALL' | Status | 'NO_MATCH' | 'TV' | 'BOOK';

/** One-off imports from Letterboxd (export or profile link), Goodreads (CSV export) and AniList (data export). Nothing is written until "Add". */
export function ImportPanel() {
  const { notify, bump } = useApp();
  const [profile, setProfile] = useState('');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('ALL');
  const file = useRef<HTMLInputElement>(null);
  const lbFile = useRef<HTMLInputElement>(null);
  const anilistFile = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const running = !!job && !job.finished;

  // Poll the running job once a second.
  useEffect(() => {
    if (!job || job.finished) return;
    const t = setTimeout(async () => {
      try {
        const j = await api.importJob(job.id);
        setJob(j);
        if (!j.finished) return;
        if (j.error) notify(j.error, { error: true });
        else if (j.kind === 'PREVIEW' && j.items) {
          setItems(j.items);
          setNotice(j.notice);
          setFilter('ALL');
          setPicked(new Set(j.items.filter((i) => !i.in_pit).map((i) => i.key)));
        } else if (j.kind === 'IMPORT' && j.result) {
          const r = j.result;
          notify(
            `Added ${r.added} to the Pit${r.skipped ? ` · ${r.skipped} already there` : ''}${r.failed.length ? ` · ${r.failed.length} failed: ${r.failed.slice(0, 3).join(', ')}` : ''}`,
            { error: r.failed.length > 0 },
          );
          setItems(null);
          bump();
        }
      } catch (e) {
        setJob(null);
        notify((e as ApiError).message, { error: true });
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [job, notify, bump]);

  const start = async (fn: () => Promise<ImportJob>) => {
    try {
      setItems(null);
      setJob(await fn());
    } catch (e) {
      notify((e as ApiError).message, { error: true });
    }
  };

  // AniList's GDPR export also holds the account's email, IP and messages: only the anime and manga rows of `lists` are sent.
  const readAnilist = async (f: File | undefined) => {
    if (anilistFile.current) anilistFile.current.value = '';
    if (!f) return;
    let lists: unknown;
    try {
      lists = JSON.parse(await f.text())?.lists;
    } catch {
      return notify('That file isn’t valid JSON. Choose the gdpr_data.json from your AniList data download.', { error: true });
    }
    if (!Array.isArray(lists)) return notify('No lists found. Choose the gdpr_data.json from your AniList data download.', { error: true });
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const entries: AnilistEntry[] = lists
      .filter((l) => l && (l.series_type === 0 || l.series_type === 1) && typeof l.series_id === 'number')
      .map((l) => ({
        series_id: l.series_id,
        series_type: l.series_type,
        status: num(l.status),
        score: num(l.score),
        progress: num(l.progress),
        progress_volume: num(l.progress_volume),
        started_on: num(l.started_on),
        finished_on: num(l.finished_on),
      }));
    if (!entries.length) return notify('The AniList export has no anime or manga in it.', { error: true });
    start(() => api.anilistPreview(entries));
  };

  const readCsv = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    if (file.current) file.current.value = '';
    start(() => api.goodreadsPreview(text));
  };

  // Letterboxd export: the ZIP as downloaded, or the CSVs from inside it.
  const readExport = async (list: FileList | null) => {
    const fs = [...(list ?? [])];
    if (lbFile.current) lbFile.current.value = '';
    if (!fs.length) return;
    const zip = fs.find((f) => /\.zip$/i.test(f.name));
    if (zip) {
      const bytes = new Uint8Array(await zip.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return start(() => api.letterboxdExport({ zip: btoa(bin) }));
    }
    const files: Record<string, string> = {};
    for (const f of fs) files[f.name] = await f.text();
    start(() => api.letterboxdExport({ files }));
  };

  const types = new Set((items ?? []).map((i) => i.type));
  const what = types.size > 1 ? 'titles' : { BOOK: 'books', TV: 'shows', MOVIE: 'films' }[items?.[0]?.type ?? 'MOVIE'];
  const filters = useMemo(() => {
    const l = items ?? [];
    const out: [Filter, string][] = [['ALL', `All ${l.length}`]];
    // An AniList export mixes anime (TV) and manga (Books).
    const shows = l.filter((i) => i.type === 'TV').length;
    const books = l.filter((i) => i.type === 'BOOK').length;
    if (shows && books) out.push(['TV', `TV ${shows}`], ['BOOK', `Books ${books}`]);
    for (const s of ['COMPLETED', 'IN_PROGRESS', 'PAUSED', 'PLANNED', 'DROPPED'] as Status[]) {
      const n = l.filter((i) => i.status === s).length;
      if (n) out.push([s, `${STATUS_LABEL[s]} ${n}`]);
    }
    const unmatched = l.filter((i) => !i.match).length;
    if (unmatched) out.push(['NO_MATCH', `No match ${unmatched}`]);
    return out;
  }, [items]);
  const shown = (items ?? []).filter(
    (i) => filter === 'ALL' || (filter === 'NO_MATCH' ? !i.match : filter === 'TV' || filter === 'BOOK' ? i.type === filter : i.status === filter),
  );
  const inPit = (items ?? []).filter((i) => i.in_pit).length;
  const setAll = (on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      for (const i of shown) if (!i.in_pit) on ? n.add(i.key) : n.delete(i.key);
      return n;
    });
  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  const provider = (i: ImportItem) => ({ TMDB: 'TMDb', OPENLIBRARY: 'Open Library', ANILIST: 'AniList' })[i.match?.provider ?? 'OPENLIBRARY'];

  return (
    <section className="panel">
      <div className="panel-head">
        <h1 className="h-title">IMPORT</h1>
      </div>
      <p className="muted sm">
        A one-off copy of what you already track elsewhere. Your status and rating come across (Letterboxd ½★ = 1 point, Goodreads ★ = 2 points, AniList score ÷
        10, out of 10). Nothing is added until you review the list, and titles already in the Pit are left as they are.
      </p>
      <div className="import-sources">
        <form
          className="import-source"
          onSubmit={(e) => {
            e.preventDefault();
            if (profile.trim()) start(() => api.letterboxdPreview(profile));
          }}
        >
          <h2 className="h-section">LETTERBOXD</h2>
          <div className="muted sm">
            Watched films become Completed and your watchlist becomes Planned. <b>Full history:</b> on Letterboxd open{' '}
            <a href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener noreferrer">
              Settings → Data → Export your data ↗
            </a>{' '}
            and choose the ZIP here (it includes your diary dates). <b>Quick:</b> paste your profile link. Letterboxd only shows automated readers your most
            recent films, plus your whole watchlist.
          </div>
          <div className="row gap wrap">
            <input
              ref={lbFile}
              type="file"
              accept=".zip,.csv"
              multiple
              className="sr-only"
              id="letterboxd-export"
              onChange={(e) => readExport(e.target.files)}
              disabled={running}
            />
            <label htmlFor="letterboxd-export" className={`btn primary ${running ? 'disabled' : ''}`} aria-disabled={running}>
              Choose export ZIP…
            </label>
            <input
              className="input import-input"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="or https://letterboxd.com/yourname/"
              aria-label="Letterboxd profile link"
              disabled={running}
            />
            <button className="btn ghost" disabled={running || !profile.trim()}>
              Read profile
            </button>
          </div>
        </form>
        <div className="import-source">
          <h2 className="h-section">GOODREADS</h2>
          <div className="muted sm">
            Goodreads doesn’t allow reading shelves from a link. On Goodreads, open{' '}
            <a href="https://www.goodreads.com/review/import" target="_blank" rel="noopener noreferrer">
              My Books → Import and export ↗
            </a>
            , click Export Library, then choose the CSV here. Read becomes Completed, Currently reading becomes In progress, Want to read becomes Planned, and
            DNF shelves become Dropped.
          </div>
          <div className="row gap">
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              id="goodreads-csv"
              onChange={(e) => readCsv(e.target.files?.[0])}
              disabled={running}
            />
            <label htmlFor="goodreads-csv" className={`btn primary ${running ? 'disabled' : ''}`} aria-disabled={running}>
              Choose CSV…
            </label>
          </div>
        </div>
        <div className="import-source">
          <h2 className="h-section">ANILIST</h2>
          <div className="muted sm">
            Your anime list goes into TV and your manga into Books. On AniList, request your data download from{' '}
            <a href="https://anilist.co/settings/account" target="_blank" rel="noopener noreferrer">
              Settings → Account ↗
            </a>
            , then choose the gdpr_data.json here. Only your lists are read from it. Watching/Reading becomes In progress, Planning becomes Planned,
            Rewatching/Rereading becomes Completed. Episode progress is ticked off; chapter progress goes into the book’s notes.
          </div>
          <div className="row gap">
            <input
              ref={anilistFile}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              id="anilist-json"
              onChange={(e) => readAnilist(e.target.files?.[0])}
              disabled={running}
            />
            <label htmlFor="anilist-json" className={`btn primary ${running ? 'disabled' : ''}`} aria-disabled={running}>
              Choose JSON…
            </label>
          </div>
        </div>
      </div>

      {running && (
        <div className="import-progress">
          <span className="sm">{job!.phase}</span>
          {job!.total > 0 && <Progress value={job!.done} max={job!.total} label={job!.kind === 'IMPORT' ? 'added' : 'matched'} />}
        </div>
      )}

      {items && !running && (
        <div className="import-review">
          <div className="row gap wrap">
            <div className="seg" role="radiogroup" aria-label="Show">
              {filters.map(([f, label]) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
            <button className="btn ghost sm" onClick={() => setAll(true)}>
              Tick all shown
            </button>
            <button className="btn ghost sm" onClick={() => setAll(false)}>
              Untick all shown
            </button>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => setItems(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!picked.size} onClick={() => start(() => api.importItems(items.filter((i) => picked.has(i.key))))}>
              Add {picked.size} {what} to the Pit
            </button>
          </div>
          {notice && <div className="notice">{notice}</div>}
          {inPit > 0 && <div className="muted sm">{inPit} already in the Pit (greyed out).</div>}
          <div className="import-list">
            <table className="table">
              <tbody>
                {shown.map((i) => (
                  <tr key={i.key} className={i.in_pit ? 'dim' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={picked.has(i.key)}
                        disabled={!!i.in_pit}
                        onChange={() => toggle(i.key)}
                        aria-label={`Import ${i.title}`}
                      />
                    </td>
                    <td>
                      <Cover media={{ cover_url: i.match?.cover_url ?? null, title: i.title, type: i.type }} />
                    </td>
                    <td>
                      <div>
                        {i.title} {i.year && <span className="muted">({i.year})</span>}
                      </div>
                      <div className="muted sm">
                        {[
                          i.creator,
                          i.tv && animeLine(i),
                          i.manga && mangaLine(i),
                          i.in_pit
                            ? 'Already in the Pit'
                            : i.match
                              ? normal(i.match.title) !== normal(i.title)
                                ? `${provider(i)}: ${i.match.title}${i.match.year ? ` (${i.match.year})` : ''}`
                                : `Matched on ${provider(i)}`
                              : 'No match: added from the export’s own details',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                    <td>
                      <StatusPill status={i.status} />
                    </td>
                    <td className="sm">{i.rating != null ? <span className="my-rating">★ {i.rating}/10</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="source-line">
            {items[0]?.source === 'LETTERBOXD'
              ? 'Film list and ratings from your Letterboxd profile. This product uses the TMDB API but is not endorsed or certified by TMDB.'
              : items[0]?.source === 'ANILIST'
                ? 'List, scores and progress from your AniList export. Anime and manga data from AniList (anilist.co).'
                : 'Shelves and ratings from your Goodreads export. Book data from Open Library (openlibrary.org).'}
          </p>
        </div>
      )}
    </section>
  );
}

/** "TV · 12/24 ep" — format and episode progress for an AniList row. */
function animeLine(i: ImportItem): string {
  const tv = i.tv!;
  const total = tv.episodes ? Math.max(tv.episodes, tv.watched) : null;
  const seen = i.status === 'COMPLETED' && total ? total : tv.watched;
  const eps = total ? `${seen}/${total} ep` : seen ? `${seen} ep watched` : null;
  return [tv.format?.replace(/_/g, ' '), eps].filter(Boolean).join(' · ');
}

/** "MANGA · ch 45/162" — format and chapter progress for an AniList manga row. */
function mangaLine(i: ImportItem): string {
  const m = i.manga!;
  const of = (n: number | null) => (n ? `/${n}` : '');
  const read =
    i.status === 'COMPLETED'
      ? null
      : m.chapters_read
        ? `ch ${m.chapters_read}${of(m.chapters)}`
        : m.volumes_read
          ? `vol ${m.volumes_read}${of(m.volumes)}`
          : null;
  return [m.format?.replace(/_/g, ' '), read].filter(Boolean).join(' · ');
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
