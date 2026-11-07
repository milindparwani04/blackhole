import { useEffect, useMemo, useState } from 'react';
import { STATUSES, type LibraryRow, type MediaType, type Status } from '../../../../packages/shared/src/index';
import { api } from '../api';
import { useApp } from '../context';
import { ConfirmButton, Cover, DifficultyBar, Empty, MovieRatingBadges, StatusPill } from '../components/Bits';
import { TypeIcon } from '../components/Icons';
import { setSettings, useAnilistFilter, useSettings } from '../settings';
import { fmtDate, fmtHours, fmtRange, pct, STATUS_LABEL, TYPE_LABEL } from '../format';
import { SpinWheel } from './SpinWheel';

type Sort = 'added' | 'title' | 'normal' | 'platinum' | 'difficulty' | 'year' | 'imdb' | 'rt';

const keepAll = () => true;

export function LibraryView({ type, archived }: { type?: MediaType; archived?: boolean }) {
  const { version, openAdd, bump, notify } = useApp();
  const { showReviews, includeAnime, includeManga } = useSettings();
  const anilist = useAnilistFilter();
  // The archive has no include toggles, so it never hides anything.
  const anilistFilter = archived ? keepAll : anilist;
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [status, setStatus] = useState<Status | ''>('');
  const [platform, setPlatform] = useState('');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<Sort>('added');
  const [maxPlat, setMaxPlat] = useState('');
  const [minImdb, setMinImdb] = useState('');
  const [minRt, setMinRt] = useState('');
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const [spin, setSpin] = useState(false);
  // Multi-select: `picking` swaps row clicks from "open details" to "toggle"; `picked` holds entry ids.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  // Switching to another type or the archive drops the selection.
  useEffect(() => {
    setPicking(false);
    setPicked(new Set());
  }, [type, archived]);

  useEffect(() => {
    if (!picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPicking(false);
      setPicked(new Set());
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [picking]);

  useEffect(() => {
    // `live` drops a slow older response (e.g. a previous status filter) so it can't overwrite a newer one.
    let live = true;
    api
      .list({ type, archived, status: status || undefined })
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [type, archived, status, version]);

  const platforms = useMemo(() => [...new Set((rows ?? []).map((r) => r.entry.play_platform).filter((p): p is string => !!p))].sort(), [rows]);

  const shown = useMemo(() => {
    let list = (rows ?? []).filter(anilistFilter);
    if (text.trim()) list = list.filter((r) => r.media.title.toLowerCase().includes(text.trim().toLowerCase()));
    if (platform) list = list.filter((r) => r.entry.play_platform === platform);
    if (maxPlat) {
      // Unknown values never pass a numeric filter unless explicitly included (FR-01).
      const cap = Number(maxPlat);
      list = list.filter((r) => {
        const h = r.platinum_hours?.max ?? r.platinum_hours?.min;
        return h == null ? includeUnknown : h <= cap;
      });
    }
    if (minImdb && showReviews) list = list.filter((r) => (r.ratings?.imdb ? r.ratings.imdb.score >= Number(minImdb) : includeUnknown));
    if (minRt && showReviews) list = list.filter((r) => (r.ratings?.rt_audience ? r.ratings.rt_audience.score >= Number(minRt) : includeUnknown));
    const num = (v: number | null | undefined) => (v == null ? Infinity : v);
    const sorted = [...list];
    if (sort === 'title') sorted.sort((a, b) => a.media.title.localeCompare(b.media.title));
    // Newest first; unknown years last.
    if (sort === 'year') sorted.sort((a, b) => num(a.media.year == null ? null : -a.media.year) - num(b.media.year == null ? null : -b.media.year));
    if (sort === 'normal') sorted.sort((a, b) => num(a.normal_hours) - num(b.normal_hours));
    if (sort === 'platinum') sorted.sort((a, b) => num(a.platinum_hours?.max ?? a.platinum_hours?.min) - num(b.platinum_hours?.max ?? b.platinum_hours?.min));
    // Highest rated first; unknown last.
    if (sort === 'imdb' && showReviews)
      sorted.sort((a, b) => num(a.ratings?.imdb ? -a.ratings.imdb.score : null) - num(b.ratings?.imdb ? -b.ratings.imdb.score : null));
    if (sort === 'rt' && showReviews)
      sorted.sort(
        (a, b) => num(a.ratings?.rt_audience ? -a.ratings.rt_audience.score : null) - num(b.ratings?.rt_audience ? -b.ratings.rt_audience.score : null),
      );
    if (sort === 'difficulty') sorted.sort((a, b) => num(a.difficulty?.max ?? a.difficulty?.min) - num(b.difficulty?.max ?? b.difficulty?.min));
    return sorted;
  }, [rows, anilistFilter, text, platform, sort, maxPlat, minImdb, minRt, includeUnknown, showReviews]);

  // Bulk actions only touch selected rows that are still visible, so a filter change never hides a pending delete.
  const targets = picking ? shown.filter((r) => picked.has(r.entry.id)) : [];
  const stopPicking = () => {
    setPicking(false);
    setPicked(new Set());
  };
  const runBulk = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      notify(await work());
      stopPicking();
      bump();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Bulk change failed', { error: true });
    } finally {
      setBusy(false);
    }
  };
  const bulkStatus = (s: Status) =>
    runBulk(async () => {
      const r = await api.bulkStatus(
        targets.map((t) => t.entry.id),
        s,
      );
      return `${r.changed} set to ${STATUS_LABEL[s]}${r.unchanged ? ` · ${r.unchanged} already were` : ''}`;
    });
  const bulkRemove = () =>
    runBulk(async () => {
      const r = await api.bulkRemove(targets.map((t) => t.entry.id));
      return `${r.deleted} removed from the Pit`;
    });

  const inScope = (rows ?? []).filter(anilistFilter);
  const done = inScope.filter((r) => r.entry.status === 'COMPLETED').length;
  const title = archived ? 'ARCHIVE' : `${TYPE_LABEL[type!].one.toUpperCase()} BACKLOG`;

  return (
    <section className="panel library">
      <div className="panel-head">
        <div className="row gap">
          {type && <TypeIcon type={type} size={30} />}
          <div>
            <h1 className="h-title">{title}</h1>
            <div className="eyebrow muted">
              {inScope.length} {archived ? 'ARCHIVED' : TYPE_LABEL[type!].many.toUpperCase()}
              {!archived && ` · ${done} ${TYPE_LABEL[type!].done.toUpperCase()} · ${pct(done, inScope.length)}%`}
            </div>
          </div>
        </div>
        <div className="row gap">
          <button
            className={`btn ghost${picking ? ' on' : ''}`}
            onClick={() => (picking ? stopPicking() : setPicking(true))}
            aria-pressed={picking}
            title="Select several titles to change their status or remove them"
          >
            {picking ? 'DONE' : 'SELECT'}
          </button>
          {!archived && (
            <>
              <button className="btn ghost" onClick={() => setSpin(true)} title="Pick a random title from the Planned and Paused backlog">
                SPIN
              </button>
              <button className="btn primary" onClick={() => openAdd(type)}>
                + ADD TO THE PIT
              </button>
            </>
          )}
        </div>
        {spin && type && <SpinWheel type={type} onClose={() => setSpin(false)} />}
      </div>

      <div className="filters" role="group" aria-label="Filters">
        <input className="input" placeholder="Filter by title" value={text} onChange={(e) => setText(e.target.value)} aria-label="Filter by title" />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status | '')} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        {type === 'GAME' && (
          <>
            <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
              <option value="">All platforms</option>
              {platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <select className="input" value={maxPlat} onChange={(e) => setMaxPlat(e.target.value)} aria-label="Platinum hours">
              <option value="">Any Platinum time</option>
              {[10, 20, 40, 60, 100].map((h) => (
                <option key={h} value={h}>
                  Platinum ≤ {h}h
                </option>
              ))}
            </select>
            {maxPlat && (
              <label className="check">
                <input type="checkbox" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} /> Include unknown
              </label>
            )}
          </>
        )}
        {type === 'MOVIE' && showReviews && (
          <>
            <select className="input" value={minImdb} onChange={(e) => setMinImdb(e.target.value)} aria-label="Minimum IMDb rating">
              <option value="">Any IMDb rating</option>
              {[6, 7, 7.5, 8, 8.5].map((v) => (
                <option key={v} value={v}>
                  IMDb ≥ {v.toFixed(1)}
                </option>
              ))}
            </select>
            <select className="input" value={minRt} onChange={(e) => setMinRt(e.target.value)} aria-label="Minimum Rotten Tomatoes audience score">
              <option value="">Any RT audience score</option>
              {[60, 70, 80, 90].map((v) => (
                <option key={v} value={v}>
                  RT audience ≥ {v}%
                </option>
              ))}
            </select>
            {(minImdb || minRt) && (
              <label className="check">
                <input type="checkbox" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} /> Include unrated
              </label>
            )}
          </>
        )}
        {type === 'TV' && (
          <label className="check" title="Anime are the shows imported from AniList">
            <input type="checkbox" checked={includeAnime} onChange={(e) => setSettings({ includeAnime: e.target.checked })} /> Include anime
          </label>
        )}
        {type === 'BOOK' && (
          <label className="check" title="Manga are the books imported from AniList">
            <input type="checkbox" checked={includeManga} onChange={(e) => setSettings({ includeManga: e.target.checked })} /> Include manga
          </label>
        )}
        <span className="spacer" />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="added">Sort: Date added</option>
          <option value="title">Sort: Title</option>
          <option value="year">Sort: Year</option>
          {type === 'GAME' && (
            <>
              <option value="normal">Sort: Normal time</option>
              <option value="platinum">Sort: Platinum hours</option>
              <option value="difficulty">Sort: Difficulty</option>
            </>
          )}
          {type === 'MOVIE' && showReviews && (
            <>
              <option value="imdb">Sort: IMDb rating</option>
              <option value="rt">Sort: RT audience</option>
            </>
          )}
        </select>
      </div>

      {picking && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="eyebrow">{targets.length} SELECTED</span>
          <select
            className="input"
            value=""
            disabled={!targets.length || busy}
            onChange={(e) => e.target.value && bulkStatus(e.target.value as Status)}
            aria-label="Set status of selected titles"
          >
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <ConfirmButton className="btn danger-ghost sm" confirm={`Remove ${targets.length} forever`} onConfirm={bulkRemove} disabled={!targets.length || busy}>
            Remove from Pit
          </ConfirmButton>
          <span className="spacer" />
          <span className="muted sm">Click rows · Shift-click for a range · Esc to finish</span>
        </div>
      )}

      {rows === null ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>
          {rows.length ? 'No entries match these filters.' : archived ? 'Nothing archived.' : `No ${TYPE_LABEL[type!].many.toLowerCase()} in the Pit yet.`}
        </Empty>
      ) : (
        <LibraryTable type={type} rows={shown} picked={picking ? picked : undefined} onPick={setPicked} />
      )}
    </section>
  );
}

export function LibraryTable({
  type,
  rows,
  picked,
  onPick,
}: {
  type?: MediaType;
  rows: LibraryRow[];
  /** When set, the table is in multi-select mode and row clicks toggle membership. */
  picked?: Set<string>;
  onPick?: (next: Set<string>) => void;
}) {
  const { showReviews } = useSettings();
  const { select, selectedId } = useApp();
  const [anchor, setAnchor] = useState<number | null>(null);
  const picking = !!picked && !!onPick;
  const isPicked = (id: string) => !!picked?.has(id);
  const allPicked = picking && rows.length > 0 && rows.every((r) => isPicked(r.entry.id));
  const somePicked = picking && rows.some((r) => isPicked(r.entry.id));

  const toggle = (i: number, range: boolean) => {
    if (!picked || !onPick) return;
    const next = new Set(picked);
    if (range && anchor != null && anchor < rows.length) {
      // Shift-click: the whole span takes the anchor row's state.
      const on = picked.has(rows[anchor].entry.id);
      for (let k = Math.min(anchor, i); k <= Math.max(anchor, i); k++) {
        if (on) next.add(rows[k].entry.id);
        else next.delete(rows[k].entry.id);
      }
    } else {
      const id = rows[i].entry.id;
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setAnchor(i);
    }
    onPick(next);
  };
  const toggleAll = () => {
    if (!picked || !onPick) return;
    const next = new Set(picked);
    for (const r of rows) {
      if (allPicked) next.delete(r.entry.id);
      else next.add(r.entry.id);
    }
    onPick(next);
  };
  const activate = (i: number, range: boolean) => (picking ? toggle(i, range) : select(rows[i].entry.id));

  return (
    <div className="table-wrap">
      <table className={picking ? 'table picking' : 'table'}>
        <thead>
          <tr>
            {picking && (
              <th className="pick">
                <input
                  type="checkbox"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = somePicked && !allPicked;
                  }}
                  onChange={toggleAll}
                  aria-label={allPicked ? 'Deselect all shown' : 'Select all shown'}
                />
              </th>
            )}
            <th className="num">#</th>
            <th>Title</th>
            {type === 'GAME' && (
              <>
                <th>Normal time</th>
                <th>Platinum</th>
                <th>Difficulty</th>
                <th>Playing on</th>
              </>
            )}
            {type === 'MOVIE' && (
              <>
                <th>Runtime</th>
                {showReviews && <th>Ratings</th>}
                <th>My rating</th>
              </>
            )}
            {type === 'TV' && (
              <>
                <th>Seasons</th>
                <th>Progress</th>
              </>
            )}
            {type === 'BOOK' && (
              <>
                <th>Author</th>
                <th>Progress</th>
              </>
            )}
            {!type && <th>Type</th>}
            <th>Status</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.entry.id}
              className={(picking ? isPicked(r.entry.id) : selectedId === r.entry.id) ? 'selected' : ''}
              tabIndex={0}
              onClick={(e) => activate(i, e.shiftKey)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), activate(i, e.shiftKey))}
              aria-label={picking ? `${r.media.title}, ${isPicked(r.entry.id) ? 'selected' : 'not selected'}` : `${r.media.title}, open details`}
              aria-selected={picking ? isPicked(r.entry.id) : undefined}
            >
              {picking && (
                <td className="pick">
                  <input type="checkbox" checked={isPicked(r.entry.id)} readOnly tabIndex={-1} aria-hidden="true" />
                </td>
              )}
              <td className="num muted">{String(i + 1).padStart(2, '0')}</td>
              <td>
                <span className="title-cell">
                  <Cover media={r.media} />
                  <span>
                    <span className="title">{r.media.title}</span>
                    <span className="muted sm">{[...r.media.genres.slice(0, 2), r.media.year].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
              </td>
              {type === 'GAME' && (
                <>
                  <td>{fmtHours(r.normal_hours)}</td>
                  <td>
                    {r.platinum === 'NOT_APPLICABLE' ? (
                      <span className="muted" title="No PlayStation edition">
                        N/A
                      </span>
                    ) : r.platinum === 'NO' ? (
                      <span className="muted">No Plat</span>
                    ) : (
                      fmtRange(r.platinum_hours?.min, r.platinum_hours?.max)
                    )}
                  </td>
                  <td>
                    {r.platinum === 'NOT_APPLICABLE' ? (
                      <span className="muted">—</span>
                    ) : (
                      <DifficultyBar min={r.difficulty?.min ?? null} max={r.difficulty?.max ?? null} />
                    )}
                  </td>
                  <td className="sm" title={r.media.platforms.join(', ')}>
                    {r.entry.play_platform ?? '—'}
                  </td>
                </>
              )}
              {type === 'MOVIE' && (
                <>
                  <td>{r.media.runtime_min ? `${Math.floor(r.media.runtime_min / 60)}h ${r.media.runtime_min % 60}m` : '—'}</td>
                  {showReviews && (
                    <td>
                      <MovieRatingBadges ratings={r.ratings} />
                    </td>
                  )}
                  <td>{r.entry.personal_rating != null ? <span className="my-rating">★ {r.entry.personal_rating}</span> : '—'}</td>
                </>
              )}
              {type === 'TV' && (
                <>
                  <td>{r.tv?.seasons || '—'}</td>
                  <td>
                    <Progress value={r.tv?.watched ?? 0} max={r.tv?.eligible ?? 0} label="episodes" />
                  </td>
                </>
              )}
              {type === 'BOOK' && (
                <>
                  <td className="sm">{r.media.creator ?? '—'}</td>
                  <td>{r.pages ? <Progress value={r.entry.current_page ?? 0} max={r.pages} label="pages" /> : <span className="muted">pages unknown</span>}</td>
                </>
              )}
              {!type && <td className="sm">{TYPE_LABEL[r.media.type].one}</td>}
              <td>
                <StatusPill status={r.entry.status} />
              </td>
              <td className="sm muted">{fmtDate(r.entry.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  if (!max) return <span className="muted">—</span>;
  return (
    <span className="progress" title={`${value} of ${max} ${label}`}>
      <span className="progress-bar" aria-hidden="true">
        <i style={{ width: `${pct(value, max)}%` }} />
      </span>
      <span className="sm">
        {value}/{max}
      </span>
    </span>
  );
}
