import type { MediaType } from '../../../../packages/shared/src/index';

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const GameIcon = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20}>
    <path d="M6 9h4M8 7v4M15 10h.01M18 8h.01" />
    <path d="M7.5 5h9a5 5 0 0 1 4.9 6l-1 4.6a2.6 2.6 0 0 1-4.6 1L14 15h-4l-1.8 1.6a2.6 2.6 0 0 1-4.6-1l-1-4.6A5 5 0 0 1 7.5 5Z" />
  </svg>
);
export const FilmIcon = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
);
export const TvIcon = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20}>
    <rect x="3" y="7" width="18" height="13" rx="1.5" />
    <path d="m8 3 4 4 4-4" />
  </svg>
);
export const BookIcon = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20}>
    <path d="M12 6c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2Z" />
    <path d="M12 6v14" />
  </svg>
);
export const TrophyIcon = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M9.5 17h5" />
  </svg>
);
export const SearchIcon = () => (
  <svg {...base} width={16} height={16}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const ExternalIcon = () => (
  <svg {...base} width={14} height={14}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

export const TypeIcon = ({ type, size }: { type: MediaType; size?: number }) =>
  type === 'GAME' ? <GameIcon size={size} /> : type === 'MOVIE' ? <FilmIcon size={size} /> : type === 'TV' ? <TvIcon size={size} /> : <BookIcon size={size} />;

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="logo-mark">
      <defs>
        <radialGradient id="bh-glow" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#000" />
          <stop offset="80%" style={{ stopColor: 'var(--accent-2)' }} stopOpacity="0.55" />
          <stop offset="100%" style={{ stopColor: 'var(--accent)' }} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="22" fill="url(#bh-glow)" />
      <circle cx="32" cy="32" r="14" fill="#000" style={{ stroke: 'var(--text)' }} strokeWidth="1.6" />
      <ellipse cx="32" cy="33" rx="29" ry="6.5" fill="none" style={{ stroke: 'var(--accent-2)' }} strokeWidth="1.4" transform="rotate(-14 32 33)" opacity="0.9" />
    </svg>
  );
}
