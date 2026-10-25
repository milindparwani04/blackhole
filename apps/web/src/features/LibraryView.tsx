import { useEffect, useMemo, useState } from 'react';
import { STATUSES, type LibraryRow, type MediaType, type Status } from '../../../../packages/shared/src/index';
import { api } from '../api';
import { useApp } from '../context';
import { Cover, DifficultyBar, Empty, StatusPill } from '../components/Bits';
import { TypeIcon } from '../components/Icons';
import { fmtDate, fmtHours, fmtRange, pct, STATUS_LABEL, TYPE_LABEL } from '../format';

type Sort = 'added' | 'title' | 'normal' | 'platinum' | 'difficulty' | 'year';

export function LibraryView({ type, archived }: { type?: MediaType; archived?: boolean }) {
  const { version, openAdd } = useApp();
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [status, setStatus] = useState<Status | ''>('');
  const [platform, setPlatform] = useState('');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<Sort>('added');
  const [maxPlat, setMaxPlat] = useState('');
  const [includeUnknown, setIncludeUnknown] = useState(true);

  useEffect(() => {
    api
      .list({ type, archived, status: status || undefined })
      .then(setRows)
      .catch(() => setRows([]));
  }, [type, archived, status, version]);

  const platforms = useMemo(() => [...new Set((rows ?? []).map((r) => r.entry.play_platform).filter((p): p is string => !!p))].sort(), [rows]);

  const shown = useMemo(() => {
    let list = rows ?? [];
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
    const num = (v: number | null | undefined) => (v == null ? Infinity : v);
    const sorted = [...list];
    if (sort === 'title') sorted.sort((a, b) => a.media.title.localeCompare(b.media.title));
    // Newest first; unknown years last.
    if (sort === 'year') sorted.sort((a, b) => num(a.media.year == null ? null : -a.media.year) - num(b.media.year == null ? null : -b.media.year));
    if (sort === 'normal') sorted.sort((a, b) => num(a.normal_hours) - num(b.normal_hours));
    if (sort === 'platinum') sorted.sort((a, b) => num(a.platinum_hours?.max ?? a.platinum_hours?.min) - num(b.platinum_hours?.max ?? b.platinum_hours?.min));
    if (sort === 'difficulty') sorted.sort((a, b) => num(a.difficulty?.max ?? a.difficulty?.min) - num(b.difficulty?.max ?? b.difficulty?.min));
    return sorted;
  }, [rows, text, platform, sort, maxPlat, includeUnknown]);

  const done = (rows ?? []).filter((r) => r.entry.status === 'COMPLETED').length;
  const title = archived ? 'ARCHIVE' : `${TYPE_LABEL[type!].one.toUpperCase()} BACKLOG`;

  return (
    <section className="panel library">
      <div className="panel-head">
        <div className="row gap">
          {type && <TypeIcon type={type} size={30} />}
          <div>
            <h1 className="h-title">{title}</h1>
            <div className="eyebrow muted">
              {rows?.length ?? 0} {archived ? 'ARCHIVED' : TYPE_LABEL[type!].many.toUpperCase()}
              {!archived && ` · ${done} ${TYPE_LABEL[type!].done.toUpperCase()} · ${pct(done, rows?.length ?? 0)}%`}
            </div>
          </div>
        </div>
        {!archived && (
          <button className="btn primary" onClick={() => openAdd(type)}>
            + ADD TO THE PIT
          </button>
        )}
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
        </select>
      </div>

      {rows === null ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>{rows.length ? 'No entries match these filters.' : archived ? 'Nothing archived.' : `No ${TYPE_LABEL[type!].many.toLowerCase()} in the Pit yet.`}</Empty>
      ) : (
        <LibraryTable type={type} rows={shown} />
      )}
    </section>
  );
}

export function LibraryTable({ type, rows }: { type?: MediaType; rows: LibraryRow[] }) {
  const { select, selectedId } = useApp();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
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
              className={selectedId === r.entry.id ? 'selected' : ''}
              tabIndex={0}
              onClick={() => select(r.entry.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(r.entry.id))}
              aria-label={`${r.media.title}, open details`}
            >
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
                  <td>{r.platinum === 'NOT_APPLICABLE' ? <span className="muted" title="No PlayStation edition">N/A</span> : r.platinum === 'NO' ? <span className="muted">No Plat</span> : fmtRange(r.platinum_hours?.min, r.platinum_hours?.max)}</td>
                  <td>{r.platinum === 'NOT_APPLICABLE' ? <span className="muted">—</span> : <DifficultyBar min={r.difficulty?.min ?? null} max={r.difficulty?.max ?? null} />}</td>
                  <td className="sm" title={r.media.platforms.join(', ')}>{r.entry.play_platform ?? '—'}</td>
                </>
              )}
              {type === 'MOVIE' && (
                <>
                  <td>{r.media.runtime_min ? `${Math.floor(r.media.runtime_min / 60)}h ${r.media.runtime_min % 60}m` : '—'}</td>
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
