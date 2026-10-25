import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryRow, MediaType } from '../../../packages/shared/src/index';
import { api, ApiError, type Stats } from './api';
import { Ctx, useApp, type AppCtx } from './context';
import { Logo, SearchIcon, TypeIcon } from './components/Icons';
import { Dashboard } from './features/Dashboard';
import { LibraryView } from './features/LibraryView';
import { Inspector } from './features/Inspector';
import { AddModal } from './features/AddModal';
import { DataView } from './features/DataView';
import { TYPE_LABEL } from './format';

type View = { kind: 'dashboard' } | { kind: 'library'; type: MediaType } | { kind: 'archive' } | { kind: 'data' };

const ROUTES: Record<string, View> = {
  '': { kind: 'dashboard' },
  games: { kind: 'library', type: 'GAME' },
  movies: { kind: 'library', type: 'MOVIE' },
  tv: { kind: 'library', type: 'TV' },
  books: { kind: 'library', type: 'BOOK' },
  archive: { kind: 'archive' },
  data: { kind: 'data' },
};
const SLUG: Record<MediaType, string> = { GAME: 'games', MOVIE: 'movies', TV: 'tv', BOOK: 'books' };
const readRoute = (): View => ROUTES[location.hash.replace(/^#\/?/, '')] ?? { kind: 'dashboard' };

interface Toast {
  id: number;
  message: string;
  eventId?: string | null;
  error?: boolean;
}

export function App() {
  const [view, setView] = useState<View>(readRoute);
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [add, setAdd] = useState<{ type: MediaType; query: string } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const toastTimer = useRef<number>(undefined);

  useEffect(() => {
    const on = () => setView(readRoute());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
  }, [version]);

  const notify = useCallback<AppCtx['notify']>((message, opts) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, ...opts });
    toastTimer.current = window.setTimeout(() => setToast(null), opts?.eventId ? 8000 : 4500);
  }, []);

  const ctx: AppCtx = useMemo(
    () => ({
      version,
      bump: () => setVersion((v) => v + 1),
      selectedId,
      select: setSelectedId,
      openAdd: (type, query) => setAdd({ type: type ?? (view.kind === 'library' ? view.type : 'GAME'), query: query ?? '' }),
      notify,
    }),
    [version, selectedId, view, notify],
  );

  async function undo(eventId: string) {
    try {
      const r = await api.undo(eventId);
      notify('Change undone');
      setSelectedId(r.detail.entry.id);
      ctx.bump();
    } catch (e) {
      notify((e as ApiError).message, { error: true });
    }
  }

  const go = (hash: string) => (location.hash = `/${hash}`);
  const isActive = (v: View) => JSON.stringify(v) === JSON.stringify(view);

  return (
    <Ctx.Provider value={ctx}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className={`shell ${selectedId ? 'with-inspector' : ''}`}>
        <header className="topbar">
          <button className="brand" onClick={() => go('')} aria-label="Blackhole dashboard">
            <Logo />
            <span className="brand-name">BLACKHOLE</span>
          </button>
          <GlobalSearch />
          <div className="topbar-meta">
            <Clock />
          </div>
        </header>

        <nav className="sidebar" aria-label="Main">
          <div className="nav-group">
            <div className="nav-label">NAVIGATION</div>
            <button className={`nav-item ${isActive({ kind: 'dashboard' }) ? 'active' : ''}`} onClick={() => go('')}>
              <span className="slash">/</span> Backlog
            </button>
            <button className={`nav-item ${view.kind === 'archive' ? 'active' : ''}`} onClick={() => go('archive')}>
              <span className="slash">/</span> Archive
              {!!stats?.archived && <span className="count">{stats.archived}</span>}
            </button>
          </div>
          <div className="nav-group">
            <div className="nav-label">MEDIA</div>
            {(['GAME', 'MOVIE', 'TV', 'BOOK'] as MediaType[]).map((t) => (
              <button key={t} className={`nav-item media ${view.kind === 'library' && view.type === t ? 'active' : ''}`} onClick={() => go(SLUG[t])}>
                <TypeIcon type={t} size={18} />
                {TYPE_LABEL[t].many}
                <span className="count">{stats?.byType[t].total ?? '·'}</span>
              </button>
            ))}
          </div>
          <div className="nav-group">
            <div className="nav-label">SYSTEM</div>
            <button className={`nav-item ${view.kind === 'data' ? 'active' : ''}`} onClick={() => go('data')}>
              <span className="slash">/</span> Data &amp; Sources
            </button>
          </div>
        </nav>

        <main id="main" className="main" tabIndex={-1}>
          {view.kind === 'dashboard' && <Dashboard stats={stats} />}
          {view.kind === 'library' && <LibraryView key={view.type} type={view.type} />}
          {view.kind === 'archive' && <LibraryView key="archive" archived />}
          {view.kind === 'data' && <DataView />}
          <footer className="footer">
            <span>BLACKHOLE v0.1.0 / LOCAL</span>
            <span>BUILT LOCALLY | NO CLOUD | ALL YOUR WORLDS</span>
          </footer>
        </main>

        {selectedId && <Inspector key={selectedId} id={selectedId} />}
      </div>

      {add && <AddModal initialType={add.type} initialQuery={add.query} onClose={() => setAdd(null)} />}

      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className={`toast ${toast.error ? 'error' : ''}`} key={toast.id}>
            <span>{toast.message}</span>
            {toast.eventId && (
              <button className="btn ghost sm" onClick={() => (setToast(null), undo(toast.eventId!))}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock" aria-label="Current time">
      <span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="label">{now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}</span>
    </div>
  );
}

function GlobalSearch() {
  const { select, openAdd, version } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 1) return setRows([]);
    const t = setTimeout(() => api.list({ q: q.trim() }).then((r) => setRows(r.slice(0, 7))).catch(() => setRows([])), 150);
    return () => clearTimeout(t);
  }, [q, version]);

  return (
    <div className="global-search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <label className="search-box">
        <SearchIcon />
        <input
          ref={input}
          value={q}
          placeholder="Search the universe... (your library, or press Enter to search providers)"
          aria-label="Search your library"
          onFocus={() => setOpen(true)}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) {
              setOpen(false);
              openAdd(undefined, q.trim());
            }
            if (e.key === 'Escape') (setOpen(false), input.current?.blur());
          }}
        />
        <kbd>/</kbd>
      </label>
      {open && q.trim() && (
        <div className="search-pop" role="listbox">
          {rows.map((r) => (
            <button key={r.entry.id} className="search-hit" onClick={() => (select(r.entry.id), setOpen(false))}>
              <TypeIcon type={r.media.type} size={16} />
              <span className="title">{r.media.title}</span>
              <span className="muted">{r.media.year ?? ''}</span>
            </button>
          ))}
          {!rows.length && <div className="search-empty">Nothing in the Pit matches.</div>}
          <button className="search-hit provider" onClick={() => (setOpen(false), openAdd(undefined, q.trim()))}>
            + Find “{q.trim()}” to add to the Pit →
          </button>
        </div>
      )}
    </div>
  );
}

