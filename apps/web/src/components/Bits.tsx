import { useEffect, useState, type ReactNode } from 'react';
import type { MediaItem, Status } from '../../../../packages/shared/src/index';
import { STATUS_LABEL } from '../format';
import { TypeIcon } from './Icons';

export function Ring({ value, label }: { value: number; label: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${value}% ${label.toLowerCase()}`}>
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} className="ring-track" />
        <circle cx="24" cy="24" r={r} className="ring-value" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 24 24)" />
        <text x="24" y="28" textAnchor="middle">
          {value}%
        </text>
      </svg>
      <span className="ring-label">{label}</span>
    </div>
  );
}

/** 10-segment difficulty bar; a range fills solid to min and striped to max. */
export function DifficultyBar({ min, max }: { min: number | null; max: number | null }) {
  if (min == null && max == null) return <span className="muted" title="Unknown">—</span>;
  const lo = min ?? max!;
  const hi = max ?? min!;
  return (
    <span className="diff">
      <span className="diff-num">{lo === hi ? `${lo}/10` : `${lo}–${hi}/10`}</span>
      <span className="diff-bar" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <i key={i} className={i < Math.round(lo) ? 'on' : i < Math.round(hi) ? 'range' : ''} />
        ))}
      </span>
    </span>
  );
}

export function Cover({ media, size = 'sm' }: { media: Pick<MediaItem, 'cover_url' | 'title' | 'type'>; size?: 'sm' | 'md' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [media.cover_url]);
  if (media.cover_url && !broken) {
    return <img className={`cover ${size}`} src={media.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  // Deterministic placeholder: hue from the title so rows stay distinguishable.
  const hue = [...media.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span className={`cover placeholder ${size}`} style={{ background: `linear-gradient(160deg, hsl(${hue} 30% 22%), hsl(${(hue + 40) % 360} 25% 8%))` }} aria-hidden="true">
      <TypeIcon type={media.type} size={size === 'lg' ? 40 : 16} />
    </span>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return <span className={`pill status-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

/** Two-step inline confirmation instead of a blocking browser dialog. */
export function ConfirmButton({ children, confirm, onConfirm, className = 'btn ghost sm', disabled }: { children: ReactNode; confirm: string; onConfirm: () => void; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <span className="confirm">
      <button className="btn danger sm" onClick={() => (setArmed(false), onConfirm())}>
        {confirm}
      </button>
      <button className="btn ghost sm" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button className={className} onClick={() => setArmed(true)} disabled={disabled}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
