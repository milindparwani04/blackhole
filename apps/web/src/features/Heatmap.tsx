import { useEffect, useMemo, useRef, useState } from 'react';
import type { EntryDetail, Episode } from '../../../../packages/shared/src/index';
import { api } from '../api';
import { CloseIcon } from '../components/Icons';
import { fmtDate } from '../format';

type Act = (fn: () => Promise<any>, message?: string) => Promise<any>;

/** Documented rating legend (score out of 10). Each cell also prints its number, so colour is never the only signal. */
export const LEGEND = [
  { min: 9, label: 'Awesome', cls: 'r-awesome' },
  { min: 8, label: 'Great', cls: 'r-great' },
  { min: 7, label: 'Good', cls: 'r-good' },
  { min: 6, label: 'Regular', cls: 'r-regular' },
  { min: 0, label: 'Bad', cls: 'r-bad' },
];
const ratingClass = (score: number, scale: number) => {
  const s = (score / scale) * 10;
  return LEGEND.find((l) => s >= l.min)!.cls;
};

export function Heatmap({ d, act, onClose }: { d: EntryDetail; act: Act; onClose: () => void }) {
  const seasons = d.tv!.seasons.filter((s) => !s.is_special);
  const hasRatings = seasons.some((s) => s.episodes.some((e) => e.rating));
  const [mode, setMode] = useState<'ratings' | 'progress'>(hasRatings ? 'ratings' : 'progress');
  const [asList, setAsList] = useState(false);
  const [pos, setPos] = useState<{ s: number; e: number }>({ s: 0, e: 0 });
  const [picked, setPicked] = useState<{ season: number; ep: Episode } | null>(null);
  const maxEp = Math.max(0, ...seasons.map((s) => s.episodes.length));
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Season columns × episode rows, indexed by position (episodes can be numbered with gaps).
  const cell = (si: number, ei: number) => seasons[si]?.episodes[ei] ?? null;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    addEventListener('keydown', onKey, true);
    return () => (removeEventListener('keydown', onKey, true), prev?.focus());
  }, [onClose]);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-pos="${pos.s}-${pos.e}"]`)?.focus();
  }, [pos]);

  const avg = useMemo(
    () =>
      seasons.map((s) => {
        const r = s.episodes.filter((e) => e.rating).map((e) => (e.rating!.score / e.rating!.scale) * 10);
        return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
      }),
    [seasons],
  );

  function onGridKey(e: React.KeyboardEvent) {
    const moves: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    let { s, e: ep } = pos;
    // Skip over non-existent episodes in the moving direction.
    for (let i = 0; i < Math.max(seasons.length, maxEp); i++) {
      s = Math.min(seasons.length - 1, Math.max(0, s + m[0]));
      ep = Math.min(maxEp - 1, Math.max(0, ep + m[1]));
      if (cell(s, ep)) break;
    }
    if (cell(s, ep)) setPos({ s, e: ep });
  }

  const label = (si: number, ep: Episode) =>
    `Season ${seasons[si].number} Episode ${ep.number}, ${ep.rating ? `rating ${ep.rating.score.toFixed(1)}` : 'rating unavailable'}, ${ep.watched ? 'watched' : ep.released ? 'not watched' : 'not yet aired'}`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal heatmap-modal" role="dialog" aria-modal="true" aria-label={`${d.media.title} episode heatmap`} tabIndex={-1} ref={dialogRef}>
        <div className="modal-head">
          <div>
            <div className="eyebrow muted">SEASON × EPISODE</div>
            <h2 className="h-title">{d.media.title}</h2>
          </div>
          <div className="row gap wrap">
            <div className="seg" role="radiogroup" aria-label="Heatmap mode">
              <button role="radio" aria-checked={mode === 'ratings'} className={mode === 'ratings' ? 'on' : ''} onClick={() => setMode('ratings')}>
                Ratings
              </button>
              <button role="radio" aria-checked={mode === 'progress'} className={mode === 'progress' ? 'on' : ''} onClick={() => setMode('progress')}>
                My progress
              </button>
            </div>
            <button className="btn ghost sm" onClick={() => setAsList(!asList)} aria-pressed={asList}>
              {asList ? 'Grid view' : 'List view'}
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close heatmap">
              <CloseIcon />
            </button>
          </div>
        </div>

        {mode === 'ratings' && !hasRatings && (
          <div className="notice">Ratings unavailable for this show. IMDb has no episode ratings for it yet (new shows can take a while), so no colours are invented. Switch to “My progress”.</div>
        )}

        <div className="heatmap-body">
          {asList ? (
            <div className="table-wrap heat-list">
              <table className="table">
                <caption className="sr-only">Episodes by season with rating and watched state</caption>
                <thead>
                  <tr>
                    <th>Episode</th>
                    <th>Title</th>
                    <th>Aired</th>
                    <th>Rating</th>
                    <th>Watched</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.flatMap((s) =>
                    s.episodes.map((ep) => (
                      <tr key={ep.id} onClick={() => setPicked({ season: s.number, ep })}>
                        <td>
                          S{s.number}E{ep.number}
                        </td>
                        <td>{ep.title ?? '—'}</td>
                        <td className="sm">{fmtDate(ep.airdate)}</td>
                        <td>{ep.rating ? `${ep.rating.score.toFixed(1)} / ${ep.rating.scale}` : 'Unavailable'}</td>
                        <td>{ep.watched ? 'Yes' : ep.released ? 'No' : 'Not aired'}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="heat-scroll">
              <div
                className="heat-grid"
                role="grid"
                aria-label={`${mode === 'ratings' ? 'Ratings' : 'Watch progress'} by season and episode. Use arrow keys to move, Enter to open.`}
                ref={gridRef}
                onKeyDown={onGridKey}
                style={{ gridTemplateColumns: `3.2rem repeat(${seasons.length}, minmax(2.6rem, 3.2rem))` }}
              >
                <div role="row" className="heat-row">
                  <span role="columnheader" className="heat-h" />
                  {seasons.map((s) => (
                    <span role="columnheader" key={s.id} className="heat-h">
                      S{s.number}
                    </span>
                  ))}
                </div>
                {Array.from({ length: maxEp }, (_, ei) => (
                  <div role="row" className="heat-row" key={ei}>
                    <span role="rowheader" className="heat-h">
                      E{ei + 1}
                    </span>
                    {seasons.map((s, si) => {
                      const ep = cell(si, ei);
                      if (!ep) return <span role="gridcell" key={s.id} className="heat-cell absent" aria-label={`Season ${s.number} has no episode ${ei + 1}`} />;
                      const cls =
                        mode === 'ratings'
                          ? ep.rating
                            ? ratingClass(ep.rating.score, ep.rating.scale)
                            : 'r-none'
                          : ep.watched
                            ? 'p-watched'
                            : ep.released
                              ? 'p-unwatched'
                              : 'p-unreleased';
                      const focused = pos.s === si && pos.e === ei;
                      return (
                        <button
                          role="gridcell"
                          key={s.id}
                          data-pos={`${si}-${ei}`}
                          tabIndex={focused ? 0 : -1}
                          className={`heat-cell ${cls} ${picked?.ep.id === ep.id ? 'picked' : ''}`}
                          aria-label={label(si, ep)}
                          onClick={() => (setPos({ s: si, e: ei }), setPicked({ season: s.number, ep }))}
                        >
                          {mode === 'ratings' ? (ep.rating ? ep.rating.score.toFixed(1) : '–') : ep.watched ? '✓' : ep.released ? '' : '·'}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {mode === 'ratings' && hasRatings && (
                  <div role="row" className="heat-row avg">
                    <span role="rowheader" className="heat-h">
                      AVG
                    </span>
                    {avg.map((a, i) => (
                      <span role="gridcell" key={i} className="heat-avg">
                        {a == null ? '–' : a.toFixed(1)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <aside className="heat-side">
            {picked ? (
              <EpisodeDetail
                season={picked.season}
                ep={seasons.flatMap((s) => s.episodes).find((x) => x.id === picked.ep.id) ?? picked.ep}
                onToggle={async (ep) => {
                  const r = await act(() => api.watchEpisode(d.entry.id, ep.id, !ep.watched), `S${picked.season}E${ep.number} ${ep.watched ? 'unwatched' : 'watched'}`);
                  const fresh = r?.detail.tv.seasons.flatMap((s: any) => s.episodes).find((x: Episode) => x.id === ep.id);
                  if (fresh) setPicked({ season: picked.season, ep: fresh });
                }}
              />
            ) : (
              <p className="muted sm">Select a cell to see episode details.</p>
            )}
            <div className="legend" aria-label="Legend">
              {mode === 'ratings' ? (
                <>
                  {LEGEND.map((l, i) => (
                    <span key={l.cls} className="legend-item">
                      <i className={`swatch ${l.cls}`} /> {l.label} {i === 0 ? '9.0+' : i === LEGEND.length - 1 ? '< 6.0' : `${l.min}.0–${l.min}.9`}
                    </span>
                  ))}
                  <span className="legend-item">
                    <i className="swatch r-none" /> Rating unavailable
                  </span>
                </>
              ) : (
                <>
                  <span className="legend-item">
                    <i className="swatch p-watched" /> Watched
                  </span>
                  <span className="legend-item">
                    <i className="swatch p-unwatched" /> Not watched
                  </span>
                  <span className="legend-item">
                    <i className="swatch p-unreleased" /> Not aired
                  </span>
                </>
              )}
              <span className="legend-item">
                <i className="swatch absent" /> No such episode
              </span>
            </div>
            {d.tv!.ratings_attribution && <div className="source-line">{d.tv!.ratings_attribution}. These are community ratings, separate from your own rating.</div>}
          </aside>
        </div>
      </div>
    </div>
  );
}

function EpisodeDetail({ season, ep, onToggle }: { season: number; ep: Episode; onToggle: (ep: Episode) => void }) {
  return (
    <div className="ep-detail">
      <div className="eyebrow muted">
        SEASON {season} · EPISODE {ep.number}
      </div>
      <h3>{ep.title ?? `Episode ${ep.number}`}</h3>
      <dl className="facts">
        <dt>Aired</dt>
        <dd>{ep.airdate ? fmtDate(ep.airdate) : 'TBA'}</dd>
        <dt>Runtime</dt>
        <dd>{ep.runtime_min ? `${ep.runtime_min} min` : '—'}</dd>
        <dt>Rating</dt>
        <dd>{ep.rating ? `${ep.rating.score.toFixed(1)} / ${ep.rating.scale} (${ep.rating.provider})` : 'Unavailable'}</dd>
      </dl>
      {ep.summary && <p className="sm">{ep.summary}</p>}
      <button className={`btn ${ep.watched ? 'ghost' : 'primary'} wide`} disabled={!ep.released && !ep.watched} onClick={() => onToggle(ep)}>
        {ep.watched ? `✓ Watched ${fmtDate(ep.watched_at)} — unmark` : ep.released ? 'Mark watched' : 'Not aired yet'}
      </button>
    </div>
  );
}
