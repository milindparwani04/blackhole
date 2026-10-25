import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import type { LibraryRow, MediaType } from '../../../../packages/shared/src/index';
import { backlogSlots, fitRowCount } from '../../../../packages/shared/src/backlog';
import { api, type Stats } from '../api';
import { useApp } from '../context';
import { Cover, DifficultyBar, Empty, MovieRatingBadges, Ring } from '../components/Bits';
import { TypeIcon } from '../components/Icons';
import { fmtHours, fmtRange, pct, TYPE_LABEL } from '../format';

const TYPES: MediaType[] = ['GAME', 'MOVIE', 'TV', 'BOOK'];
const SLUG: Record<MediaType, string> = { GAME: 'games', MOVIE: 'movies', TV: 'tv', BOOK: 'books' };
const SLOTS = 5;

export function Dashboard({ stats }: { stats: Stats | null }) {
  const { version, openAdd } = useApp();
  const [rows, setRows] = useState<LibraryRow[] | null>(null);

  useEffect(() => {
    // `live` drops a slow older response so it can't overwrite a newer one.
    let live = true;
    api
      .list()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [version]);

  const total = rows?.length ?? 0;

  return (
    <div className="dashboard">
      <section className="stat-cards" aria-label="Library totals">
        {TYPES.map((t) => {
          const s = stats?.byType[t] ?? { total: 0, completed: 0 };
          return (
            <a key={t} className="panel stat-card" href={`#/${SLUG[t]}`}>
              <TypeIcon type={t} size={30} />
              <div>
                <div className="eyebrow">{TYPE_LABEL[t].many}</div>
                <div className="stat-num">{s.total}</div>
                <div className="eyebrow muted">IN THE PIT</div>
              </div>
              <Ring value={pct(s.completed, s.total)} label={TYPE_LABEL[t].done} />
            </a>
          );
        })}
      </section>

      {rows && total === 0 ? (
        <section className="panel hero-empty">
          <h1>The Pit is empty.</h1>
          <p className="muted">
            Add a game, movie, show or book to start. Everything is saved on this computer; nothing leaves it except provider searches you run.
          </p>
          <div className="row gap">
            {TYPES.map((t) => (
              <button key={t} className="btn primary" onClick={() => openAdd(t)}>
                + Add {TYPE_LABEL[t].one.toLowerCase()}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="backlog-grid" aria-label="Backlogs">
          {TYPES.map((t) => (
            <BacklogPanel key={t} type={t} rows={(rows ?? []).filter((r) => r.media.type === t)} loading={!rows} />
          ))}
        </section>
      )}
    </div>
  );
}

function BacklogPanel({ type, rows, loading }: { type: MediaType; rows: LibraryRow[]; loading: boolean }) {
  const { select, selectedId, openAdd } = useApp();
  const [list, setList] = useState<HTMLOListElement | null>(null);
  const fit = useFitRows(list, SLOTS);
  const slots = backlogSlots(rows, fit.rows);
  const backlog = rows.filter((r) => ['PLANNED', 'PAUSED', 'IN_PROGRESS'].includes(r.entry.status)).length;
  const active = rows.filter((r) => r.entry.status === 'IN_PROGRESS').length;
  const done = rows.filter((r) => r.entry.status === 'COMPLETED').length;

  return (
    <div className="panel backlog-panel">
      <div className="bl-head">
        <TypeIcon type={type} size={26} />
        <h2 className="h-section bl-title">{TYPE_LABEL[type].one.toUpperCase()} BACKLOG</h2>
        <div className="row gap bl-actions">
          <a className="link-more" href={`#/${SLUG[type]}`}>
            VIEW ALL →
          </a>
          <button className="btn primary sm" onClick={() => openAdd(type)} aria-label={`Add ${TYPE_LABEL[type].one.toLowerCase()} to the Pit`}>
            + ADD
          </button>
        </div>
        <div className="eyebrow muted bl-meta">
          {backlog} IN THE PIT · {active} {TYPE_LABEL[type].verb.toUpperCase()} · {done} {TYPE_LABEL[type].done.toUpperCase()}
        </div>
      </div>
      {loading ? (
        <Empty>Loading…</Empty>
      ) : slots.length === 0 ? (
        <Empty>{rows.length ? `Nothing left in the ${TYPE_LABEL[type].one.toLowerCase()} backlog.` : 'Nothing here yet.'}</Empty>
      ) : (
        <ol className="backlog-list" ref={setList} style={fit.style}>
          {slots.map((r, i) => (
            <li key={r.entry.id}>
              <button className={selectedId === r.entry.id ? 'selected' : ''} onClick={() => select(r.entry.id)}>
                <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                <Cover media={r.media} />
                <span className="bl-text">
                  <span className="title">{r.media.title}</span>
                  <span className="muted sm">{metaLine(r)}</span>
                </span>
                {r.entry.status === 'IN_PROGRESS' && <span className="pill status-in_progress">{TYPE_LABEL[type].verb.toUpperCase()}</span>}
                {r.entry.status === 'PAUSED' && <span className="pill status-paused">PAUSED</span>}
                <span className="bl-side">{sideInfo(r)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * How many backlog rows fit in `list` without squashing them. The stylesheet sets `--fit-row-min`
 * on the list only while the home view must fill exactly one screen; there the list's height comes
 * from the layout, not its rows, so showing fewer rows can't feed back into the measurement.
 * Everywhere else all `max` rows show and the page scrolls.
 */
function useFitRows(list: HTMLOListElement | null, max: number) {
  const [rows, setRows] = useState(max);
  useLayoutEffect(() => {
    if (!list) return;
    const measure = () => {
      const rowMin = parseFloat(getComputedStyle(list).getPropertyValue('--fit-row-min'));
      setRows(fitRowCount(list.clientHeight, rowMin, max));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [list, max]);
  return { rows, style: { '--rows': rows } as CSSProperties };
}

function metaLine(r: LibraryRow): string {
  const m = r.media;
  if (m.type === 'GAME') return [r.entry.play_platform, m.genres[0], m.year].filter(Boolean).join(' · ');
  if (m.type === 'MOVIE')
    return [m.year, m.runtime_min ? `${Math.floor(m.runtime_min / 60)}h ${m.runtime_min % 60}m` : null, m.genres[0]].filter(Boolean).join(' · ');
  if (m.type === 'TV') return [r.tv?.seasons ? `${r.tv.seasons} season${r.tv.seasons === 1 ? '' : 's'}` : null, m.creator, m.year].filter(Boolean).join(' · ');
  return [m.creator, r.pages ? `${r.pages} pages` : null].filter(Boolean).join(' · ');
}

function sideInfo(r: LibraryRow) {
  if (r.media.type === 'GAME') {
    return (
      <span className="bl-game">
        <span title="Normal time (IGDB)">{fmtHours(r.normal_hours)}</span>
        {r.platinum === 'NOT_APPLICABLE' ? (
          <span className="muted" title="Not playing on PlayStation">
            no plat
          </span>
        ) : (
          <span title="Platinum time">🏆 {fmtRange(r.platinum_hours?.min, r.platinum_hours?.max)}</span>
        )}
        {r.difficulty && <DifficultyBar min={r.difficulty.min} max={r.difficulty.max} />}
      </span>
    );
  }
  if (r.media.type === 'MOVIE') return <MovieRatingBadges ratings={r.ratings} />;
  if (r.media.type === 'TV' && r.tv?.eligible)
    return (
      <span className="sm">
        {r.tv.watched}/{r.tv.eligible} ep
      </span>
    );
  if (r.media.type === 'BOOK' && r.pages && r.entry.current_page) return <span className="sm">{pct(r.entry.current_page, r.pages)}%</span>;
  if (r.entry.personal_rating != null) return <span className="my-rating">★ {r.entry.personal_rating}</span>;
  return null;
}
