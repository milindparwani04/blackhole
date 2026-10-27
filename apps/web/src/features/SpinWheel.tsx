import { useEffect, useRef, useState } from 'react';
import type { LibraryRow, MediaType } from '../../../../packages/shared/src/index';
import { sliceAt, spinPool, spinTarget } from '../../../../packages/shared/src/backlog';
import { api, ApiError } from '../api';
import { useApp } from '../context';
import { Cover } from '../components/Bits';
import { CloseIcon, TypeIcon } from '../components/Icons';
import { TYPE_LABEL } from '../format';
import { useAnilistFilter, useSettings } from '../settings';

const SPIN_MS = 4800;
// Above this many slices the names no longer fit on the wheel; the readout underneath names the slice instead.
const LABEL_MAX = 24;

/** Uniform random integer in [0, n), from the browser's CSPRNG. */
function randomIndex(n: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** Spins everything waiting in one type's backlog (Planned + Paused) and offers to start the winner. */
export function SpinWheel({ type, onClose }: { type: MediaType; onClose: () => void }) {
  const { select, bump, notify } = useApp();
  const anilistFilter = useAnilistFilter();
  const { includeAnime, includeManga } = useSettings();
  const excluded = type === 'TV' && !includeAnime ? 'ANIME' : type === 'BOOK' && !includeManga ? 'MANGA' : null;
  const [pool, setPool] = useState<LibraryRow[] | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<LibraryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    let live = true;
    api
      .list({ type })
      .then((r) => live && setPool(spinPool(r.filter(anilistFilter))))
      .catch(() => live && setPool([]));
    return () => {
      live = false;
      cancelAnimationFrame(frame.current);
    };
  }, [type, anilistFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const n = pool?.length ?? 0;
  const label = TYPE_LABEL[type];

  const spin = () => {
    if (!pool || !n || spinning) return;
    const index = randomIndex(n);
    const from = rotation;
    const to = spinTarget(from, index, n, 6, randomIndex(1000) / 1000);
    setWinner(null);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRotation(to);
      setWinner(pool[index]);
      return;
    }
    setSpinning(true);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / SPIN_MS);
      setRotation(from + (to - from) * easeOut(t));
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else {
        setSpinning(false);
        setWinner(pool[index]);
      }
    };
    frame.current = requestAnimationFrame(tick);
  };

  const start = async (r: LibraryRow) => {
    setBusy(true);
    try {
      const res = await api.status(r.entry.id, 'IN_PROGRESS');
      notify(`${r.media.title} → ${label.verb}`, { eventId: res.event_id });
      bump();
      select(r.entry.id);
      onClose();
    } catch (e) {
      notify((e as ApiError).message, { error: true });
    } finally {
      setBusy(false);
    }
  };

  const current = pool && n ? pool[sliceAt(rotation, n)] : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal spin-modal" role="dialog" aria-modal="true" aria-labelledby="spin-title">
        <div className="modal-head">
          <h2 id="spin-title" className="h-title row gap">
            <TypeIcon type={type} size={22} /> SPIN THE {label.one.toUpperCase()} BACKLOG
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="spin-body">
          {pool === null ? (
            <div className="muted">Loading…</div>
          ) : n === 0 ? (
            <div className="muted">Nothing planned or paused in the {label.one.toLowerCase()} backlog.</div>
          ) : (
            <>
              <div className="eyebrow muted">
                {n} {n === 1 ? label.one.toUpperCase() : label.many.toUpperCase()} PLANNED OR PAUSED
                {excluded && ` · ${excluded} EXCLUDED`}
              </div>
              <div className="spin-stage">
                <span className="spin-pointer" aria-hidden="true" />
                <Wheel pool={pool} rotation={rotation} />
                <button className="spin-hub" onClick={spin} disabled={spinning} aria-label="Spin the wheel">
                  SPIN
                </button>
              </div>
              <div className="spin-readout" aria-live="polite">
                {winner ? (
                  <div className="spin-winner">
                    <Cover media={winner.media} />
                    <div className="spin-winner-text">
                      <div className="eyebrow muted">UP NEXT</div>
                      <div className="spin-title">{winner.media.title}</div>
                      <div className="muted sm">{[winner.media.year, winner.entry.status === 'PAUSED' ? 'Paused' : null].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                ) : (
                  <div className={`spin-title ${spinning ? '' : 'muted'}`}>{spinning ? current?.media.title : 'Press SPIN to pick what’s next.'}</div>
                )}
              </div>
              <div className="row gap spin-actions">
                {winner ? (
                  <>
                    <button className="btn ghost" onClick={spin} disabled={busy}>
                      Spin again
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        select(winner.entry.id);
                        onClose();
                      }}
                    >
                      Open
                    </button>
                    <button className="btn primary" onClick={() => start(winner)} disabled={busy}>
                      Start {label.verb.toLowerCase()}
                    </button>
                  </>
                ) : (
                  <button className="btn primary" onClick={spin} disabled={spinning}>
                    {spinning ? 'Spinning…' : 'Spin'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The wheel: one slice per backlog item, alternating tones; names only while they fit. */
function Wheel({ pool, rotation }: { pool: LibraryRow[]; rotation: number }) {
  const n = pool.length;
  const slice = 360 / n;
  const point = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(r * Math.cos(rad)).toFixed(3)} ${(r * Math.sin(rad)).toFixed(3)}`;
  };
  const tones = n % 2 === 1 && n > 1 ? 3 : 2;
  return (
    <svg className="spin-wheel" viewBox="-100 -100 200 200" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
      {n === 1 ? (
        <circle r="96" className="tone-0" />
      ) : (
        pool.map((r, i) => (
          <path
            key={r.entry.id}
            className={`tone-${i % tones}`}
            d={`M0 0 L${point(i * slice, 96)} A96 96 0 ${slice > 180 ? 1 : 0} 1 ${point((i + 1) * slice, 96)} Z`}
          />
        ))
      )}
      {n <= LABEL_MAX &&
        pool.map((r, i) => {
          const mid = i * slice + slice / 2;
          const text = r.media.title.length > 16 ? `${r.media.title.slice(0, 15)}…` : r.media.title;
          return (
            <text key={r.entry.id} className="spin-label" transform={`rotate(${mid - 90}) translate(90 0)`} textAnchor="end" dominantBaseline="middle">
              {text}
            </text>
          );
        })}
      <circle r="96" className="spin-rim" />
    </svg>
  );
}
