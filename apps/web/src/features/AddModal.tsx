import { useEffect, useRef, useState } from 'react';
import { MEDIA_TYPES, type MediaType, type MovieRatings, type SearchResponse, type SearchResult } from '../../../../packages/shared/src/index';
import { api, ApiError, type AddPayload } from '../api';
import { useApp } from '../context';
import { Cover, MovieRatingBadges } from '../components/Bits';
import { CloseIcon, SearchIcon, TypeIcon } from '../components/Icons';
import { TYPE_LABEL } from '../format';

const PLATFORM_CHIPS = ['PS5', 'PS4', 'PC', 'Switch', 'Xbox Series'];

/** A ticked search result, with the version to play for games (D-05) and any error from a failed add. */
interface Pick {
  result: SearchResult;
  platform: string | null;
  error?: string;
}

export function AddModal({ initialType, initialQuery, onClose }: { initialType: MediaType; initialQuery: string; onClose: () => void }) {
  const { select, bump, notify } = useApp();
  const [type, setType] = useState<MediaType>(initialType);
  const [q, setQ] = useState(initialQuery);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Picks survive new searches (e.g. several searches for one series) and are cleared when the media type changes.
  const [picks, setPicks] = useState<Map<string, Pick>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const qInput = useRef<HTMLInputElement>(null);
  // IMDb + RT audience for ticked movies, fetched once per result (keyed like picks).
  const [previews, setPreviews] = useState<Map<string, MovieRatings | 'loading' | 'error'>>(new Map());

  useEffect(() => {
    for (const [k, p] of picks) {
      if (p.result.type !== 'MOVIE' || p.result.provider !== 'TMDB' || previews.has(k)) continue;
      setPreviews((m) => new Map(m).set(k, 'loading'));
      api
        .previewMovieRatings(p.result.external_id)
        .then((r) => setPreviews((m) => new Map(m).set(k, r)))
        .catch(() => setPreviews((m) => new Map(m).set(k, 'error')));
    }
  }, [picks, previews]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    qInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !progress && onClose();
    addEventListener('keydown', onKey);
    return () => (removeEventListener('keydown', onKey), prev?.focus());
  }, [onClose, progress]);

  async function search(t = type, query = q) {
    if (query.trim().length < 2) return;
    setLoading(true);
    try {
      setRes(await api.search(t, query.trim()));
    } catch (e) {
      setRes({ provider: null, provider_status: 'ERROR', message: (e as ApiError).message, attribution: null, results: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRes(null);
    setPicks(new Map());
    if (initialQuery && q.trim().length >= 2) search(type, q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const key = (r: SearchResult) => `${r.provider}:${r.external_id}`;
  const addable = (res?.results ?? []).filter((r) => !r.already_in_pit);
  const allPicked = addable.length > 0 && addable.every((r) => picks.has(key(r)));

  function toggle(r: SearchResult) {
    setPicks((prev) => {
      const next = new Map(prev);
      if (next.has(key(r))) next.delete(key(r));
      else next.set(key(r), { result: r, platform: r.type === 'GAME' ? (sortForPlay(r.platforms)[0] ?? null) : null });
      return next;
    });
  }

  function toggleAll() {
    setPicks((prev) => {
      const next = new Map(prev);
      for (const r of addable) {
        if (allPicked) next.delete(key(r));
        else if (!next.has(key(r))) next.set(key(r), { result: r, platform: r.type === 'GAME' ? (sortForPlay(r.platforms)[0] ?? null) : null });
      }
      return next;
    });
  }

  const setPlatform = (k: string, platform: string) =>
    setPicks((prev) => {
      const p = prev.get(k);
      return p ? new Map(prev).set(k, { ...p, platform }) : prev;
    });

  const fromResult = (r: SearchResult): AddPayload => ({
    type: r.type,
    title: r.title,
    year: r.year,
    synopsis: r.synopsis,
    cover_url: r.cover_url,
    genres: r.genres,
    platforms: r.platforms,
    creator: r.creator,
    runtime_min: r.runtime_min,
    source_url: r.source_url,
    pages: r.pages,
    external: { provider: r.provider, external_id: r.external_id },
  });

  /** Adds every pick in order (one request at a time so provider lookups stay polite). Failures stay ticked with their reason. */
  async function addPicked() {
    const list = [...picks.entries()];
    setProgress({ done: 0, total: list.length });
    const failed = new Map<string, Pick>();
    const added: { id: string; title: string }[] = [];
    let already = 0;
    let warnings = 0;
    for (const [k, p] of list) {
      try {
        const r = await api.add({ ...fromResult(p.result), play_platform: p.platform });
        if (r.duplicate) already++;
        else added.push({ id: r.detail.entry.id, title: r.detail.media.title });
        if (r.enrichment_error) warnings++;
      } catch (e) {
        failed.set(k, { ...p, error: (e as ApiError).message });
      }
      setProgress((x) => x && { ...x, done: x.done + 1 });
    }
    setProgress(null);
    bump();
    const summary = [
      added.length && `${added.length} added to the Pit`,
      already && `${already} already there`,
      failed.size && `${failed.size} failed`,
      warnings && `${warnings} saved without episode data (use Sync later)`,
    ]
      .filter(Boolean)
      .join(' · ');
    if (failed.size) {
      setPicks(failed);
      notify(summary, { error: true });
      return;
    }
    if (added[0]) select(added[0].id);
    notify(added.length === 1 && !already ? `“${added[0].title}” added to the Pit` : summary);
    onClose();
  }

  async function addManual(p: AddPayload) {
    setBusy('manual');
    try {
      const r = await api.add(p);
      bump();
      select(r.detail.entry.id);
      notify(r.duplicate ? `“${r.detail.media.title}” is already in the Pit` : `“${r.detail.media.title}” added to the Pit`);
      onClose();
    } catch (e) {
      notify((e as ApiError).message, { error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !progress && onClose()}>
      <div className="modal add-modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head">
          <h2 id="add-title" className="h-title">
            ADD TO THE PIT
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close" disabled={!!progress}>
            <CloseIcon />
          </button>
        </div>
        <div className="type-tabs" role="tablist">
          {MEDIA_TYPES.map((t) => (
            <button key={t} role="tab" aria-selected={t === type} className={t === type ? 'on' : ''} onClick={() => setType(t)} disabled={!!progress}>
              <TypeIcon type={t} size={16} /> {TYPE_LABEL[t].one}
            </button>
          ))}
        </div>

        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <label className="search-box grow">
            <SearchIcon />
            <input ref={qInput} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${TYPE_LABEL[type].many.toLowerCase()}…`} aria-label="Search providers" />
          </label>
          <button className="btn primary" disabled={loading || q.trim().length < 2}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="add-body">
          {res && (
            <div className="results">
              {res.message && <div className={`notice ${res.provider_status === 'ERROR' ? 'error' : ''}`}>{res.message}</div>}
              {res.provider_status === 'OK' && res.results.length === 0 && <div className="muted sm">No matches. Add it manually below.</div>}
              {addable.length > 1 && (
                <label className="select-all">
                  <input type="checkbox" checked={allPicked} onChange={toggleAll} disabled={!!progress} />
                  Select all {addable.length} results
                </label>
              )}
              {res.results.map((r) => {
                const k = key(r);
                const pick = picks.get(k);
                return (
                  <div key={k} className={`result ${pick ? 'picked' : ''} ${r.already_in_pit ? 'in-pit' : ''}`}>
                    {r.already_in_pit ? (
                      <span className="pick-box done" title="Already in the Pit" aria-hidden="true">
                        ✓
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="pick-box"
                        checked={!!pick}
                        onChange={() => toggle(r)}
                        disabled={!!progress}
                        aria-label={`Select ${r.title}${r.year ? ` (${r.year})` : ''}`}
                      />
                    )}
                    <button type="button" className="result-main" onClick={() => !r.already_in_pit && !progress && toggle(r)} tabIndex={-1}>
                      <Cover media={r} size="md" />
                      <span className="result-text">
                        <span className="title">
                          {r.title} {r.year && <span className="muted">({r.year})</span>}
                        </span>
                        <span className="muted sm">{[r.creator, r.extra && r.extra !== r.creator ? r.extra : null, r.genres.slice(0, 2).join(', '), r.pages ? `~${r.pages} pages` : null].filter(Boolean).join(' · ')}</span>
                        {r.synopsis && <span className="sm clamp">{r.synopsis}</span>}
                        {pick && previews.has(k) && (
                          <span className="rating-preview sm">
                            {previews.get(k) === 'loading' ? (
                              <span className="muted">Fetching IMDb and Rotten Tomatoes ratings…</span>
                            ) : previews.get(k) === 'error' ? (
                              <span className="muted">Ratings unavailable right now</span>
                            ) : (
                              <MovieRatingBadges ratings={previews.get(k) as MovieRatings} />
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                    {r.already_in_pit && (
                      <button className="btn ghost sm" onClick={() => (select(r.already_in_pit), onClose())}>
                        In the Pit →
                      </button>
                    )}
                    {pick && r.type === 'GAME' && r.platforms.length > 1 && (
                      <PlatformPicker platforms={r.platforms} value={pick.platform} onChange={(p) => setPlatform(k, p)} disabled={!!progress} />
                    )}
                    {pick?.error && <div className="pick-error">{pick.error}</div>}
                  </div>
                );
              })}
              {res.attribution && <div className="source-line">{res.attribution}</div>}
            </div>
          )}
          <ManualForm key={type} type={type} initialTitle={q} busy={busy === 'manual'} onSubmit={addManual} />
        </div>

        {picks.size > 0 && (
          <div className="pick-bar">
            <div className="pick-chips" aria-label="Selected">
              {[...picks.entries()].map(([k, p]) => (
                <span key={k} className={`pick-chip ${p.error ? 'error' : ''}`}>
                  {p.result.title}
                  {p.result.year ? ` (${p.result.year})` : ''}
                  {p.platform && p.result.type === 'GAME' ? ` · ${p.platform}` : ''}
                  {!progress && (
                    <button
                      type="button"
                      aria-label={`Remove ${p.result.title}`}
                      onClick={() =>
                        setPicks((prev) => {
                          const next = new Map(prev);
                          next.delete(k);
                          return next;
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="row gap">
              {!progress && (
                <button className="btn ghost sm" onClick={() => setPicks(new Map())}>
                  Clear
                </button>
              )}
              <button className="btn primary" onClick={addPicked} disabled={!!progress}>
                {progress ? `Adding ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : `+ Add ${picks.size} to the Pit`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** PS5 first (owner plays there ~90% of the time), then PS4, then the rest as listed. */
export function sortForPlay(platforms: string[]) {
  const rank = (p: string) => (/^PS\s?5$/i.test(p) ? 0 : /^PS\s?4$/i.test(p) ? 1 : /^(PS|VITA)/i.test(p) ? 2 : 3);
  return [...platforms].sort((a, b) => rank(a) - rank(b));
}

/** D-05: which version a ticked game will be played on; trophy lookups follow it. */
function PlatformPicker({ platforms, value, onChange, disabled }: { platforms: string[]; value: string | null; onChange: (p: string) => void; disabled: boolean }) {
  return (
    <div className="chooser" role="radiogroup" aria-label="Which version will you play?">
      <span className="lbl">Playing on</span>
      <div className="row gap wrap">
        {sortForPlay(platforms).map((p) => (
          <label key={p} className={`chip-toggle ${value === p ? 'on' : ''}`}>
            <input type="radio" checked={value === p} onChange={() => onChange(p)} disabled={disabled} />
            {p}
          </label>
        ))}
      </div>
    </div>
  );
}

function ManualForm({ type, initialTitle, busy, onSubmit }: { type: MediaType; initialTitle: string; busy: boolean; onSubmit: (p: AddPayload) => void }) {
  const [f, setF] = useState({ title: initialTitle, year: '', creator: '', genres: '', runtime: '', pages: '', seasons: '', cover: '' });
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [otherPlatform, setOtherPlatform] = useState('');
  useEffect(() => setF((x) => ({ ...x, title: initialTitle })), [initialTitle]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const creatorLabel = type === 'BOOK' ? 'Author' : type === 'GAME' ? 'Developer' : type === 'TV' ? 'Network' : 'Director';
  const allPlatforms = sortForPlay([...platforms, ...list(otherPlatform)]);
  const [playOn, setPlayOn] = useState('');
  const playPlatform = allPlatforms.includes(playOn) ? playOn : (allPlatforms[0] ?? null);

  return (
    <details className="manual">
      <summary className="h-sub">ADD MANUALLY</summary>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const seasonCounts = f.seasons
            .split(/[,\s]+/)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0);
          onSubmit({
            type,
            title: f.title.trim(),
            year: f.year ? Number(f.year) : null,
            creator: f.creator || null,
            genres: list(f.genres),
            platforms: [...platforms, ...list(otherPlatform)],
            play_platform: type === 'GAME' ? playPlatform : null,
            runtime_min: f.runtime ? Number(f.runtime) : null,
            pages: f.pages ? Number(f.pages) : null,
            season_counts: type === 'TV' ? seasonCounts : undefined,
            cover_url: f.cover || null,
          });
        }}
      >
        <label>
          Title
          <input className="input" value={f.title} onChange={set('title')} required maxLength={300} />
        </label>
        <div className="grid2">
          <label>
            Year
            <input className="input" type="number" min="1800" max="2200" value={f.year} onChange={set('year')} />
          </label>
          <label>
            {creatorLabel}
            <input className="input" value={f.creator} onChange={set('creator')} />
          </label>
        </div>
        {type === 'GAME' && (
          <fieldset className="platforms">
            <legend>Platforms it’s on</legend>
            <div className="row gap wrap">
              {PLATFORM_CHIPS.map((p) => (
                <label key={p} className={`chip-toggle ${platforms.includes(p) ? 'on' : ''}`}>
                  <input type="checkbox" checked={platforms.includes(p)} onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))} />
                  {p}
                </label>
              ))}
              <input className="input" value={otherPlatform} onChange={(e) => setOtherPlatform(e.target.value)} placeholder="Other, comma separated" aria-label="Other platforms" />
            </div>
          </fieldset>
        )}
        {type === 'GAME' && allPlatforms.length > 1 && (
          <label>
            Playing on (trophy stats follow this)
            <select className="input" value={playPlatform ?? ''} onChange={(e) => setPlayOn(e.target.value)}>
              {allPlatforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Genres (comma separated)
          <input className="input" value={f.genres} onChange={set('genres')} />
        </label>
        {type === 'MOVIE' && (
          <label>
            Runtime (minutes)
            <input className="input" type="number" min="1" value={f.runtime} onChange={set('runtime')} />
          </label>
        )}
        {type === 'TV' && (
          <div className="grid2">
            <label>
              Episodes per season
              <input className="input" value={f.seasons} onChange={set('seasons')} placeholder="e.g. 10, 8, 12" />
            </label>
            <label>
              Typical episode length (min)
              <input className="input" type="number" min="1" value={f.runtime} onChange={set('runtime')} />
            </label>
          </div>
        )}
        {type === 'BOOK' && (
          <label>
            Pages in your edition
            <input className="input" type="number" min="1" value={f.pages} onChange={set('pages')} />
          </label>
        )}
        <label>
          Cover image URL (optional)
          <input className="input" value={f.cover} onChange={set('cover')} placeholder="https://" />
        </label>
        <button className="btn primary" disabled={busy || !f.title.trim()}>
          {busy ? 'Adding…' : `+ Add ${TYPE_LABEL[type].one.toLowerCase()} to the Pit`}
        </button>
      </form>
    </details>
  );
}
