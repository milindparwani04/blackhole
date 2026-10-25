import { useEffect, useState } from 'react';
import { STATUSES, type EntryDetail, type MutationResult, type TimeCategory, type TrophyGuide } from '../../../../packages/shared/src/index';
import { api, ApiError } from '../api';
import { useApp } from '../context';
import { ConfirmButton, Cover, DifficultyBar, Empty } from '../components/Bits';
import { CloseIcon, ExternalIcon, TrophyIcon } from '../components/Icons';
import { fmtDate, fmtDateTime, fmtHours, fmtMinutes, fmtRange, pct, STATUS_LABEL, TYPE_LABEL } from '../format';
import { Heatmap } from './Heatmap';

export function Inspector({ id }: { id: string }) {
  const { select, bump, notify, version } = useApp();
  const [d, setD] = useState<EntryDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .detail(id)
      .then((x) => (setD(x), setErr(null)))
      .catch((e: ApiError) => setErr(e.message));
  }, [id, version]);

  // A trophy lookup runs in the background after adding a game or switching version; poll until it settles.
  const running = d?.game?.trophy_job?.status === 'RUNNING';
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(
      () =>
        api
          .detail(id)
          .then((x) => {
            setD(x);
            if (x.game?.trophy_job?.status !== 'RUNNING') bump();
          })
          .catch(() => undefined),
      1500,
    );
    return () => clearTimeout(t);
  }, [running, d, id, bump]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal') && select(null);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [select]);

  /** Runs a mutation, applies its returned detail and offers undo when the server recorded an event. */
  const act = async (fn: () => Promise<MutationResult>, message?: string) => {
    try {
      const r = await fn();
      setD(r.detail);
      bump();
      if (message) notify(message, { eventId: r.event_id });
      return r;
    } catch (e) {
      notify((e as ApiError).message, { error: true });
      return null;
    }
  };

  if (err) {
    return (
      <aside className="inspector panel" aria-label="Details">
        <InspectorHead onClose={() => select(null)} />
        <Empty>{err}</Empty>
      </aside>
    );
  }
  if (!d) return <aside className="inspector panel" aria-label="Details" aria-busy="true" />;

  const { media, entry } = d;
  return (
    <aside className="inspector panel" aria-label={`${media.title} details`}>
      <InspectorHead onClose={() => select(null)} />
      <div className="insp-body">
        <div className="insp-hero">
          <Cover media={media} size="lg" />
          <div>
            <div className="eyebrow">
              <span className="dot on" aria-hidden="true" /> {TYPE_LABEL[media.type].one.toUpperCase()}
              {entry.archived_at && <span className="pill warn">ARCHIVED</span>}
            </div>
            <h2 className="insp-title">{media.title}</h2>
            <div className="muted sm">{[media.year, media.platforms.join(', '), media.creator].filter(Boolean).join(' · ')}</div>
            {media.genres.length > 0 && (
              <div className="chips">
                {media.genres.slice(0, 4).map((g) => (
                  <span key={g} className="chip">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        {media.synopsis && <p className="synopsis">{media.synopsis}</p>}
        <SourceLine label="Metadata" source={media.metadata_source} url={media.source_url} checked={media.checked_at} />

        <section className="insp-section" aria-label="Status">
          <div className="seg" role="radiogroup" aria-label="Status">
            {STATUSES.map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={entry.status === s}
                className={entry.status === s ? 'on' : ''}
                onClick={() => entry.status !== s && act(() => api.status(id, s), `Status → ${STATUS_LABEL[s]}`)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {entry.completed_at && <div className="muted sm">Last completed {fmtDateTime(entry.completed_at)}</div>}
        </section>

        {d.game && <GamePanel d={d} act={act} />}
        {d.tv && <TvPanel d={d} act={act} />}
        {d.book && <BookPanel d={d} act={act} />}
        {media.type === 'MOVIE' && (
          <section className="insp-section">
            <h3 className="h-sub">WATCHED</h3>
            {entry.status === 'COMPLETED' ? (
              <button className="btn ghost" onClick={() => act(() => api.complete(id, 'WATCHED', false), 'Marked unwatched')}>
                ✓ Watched {fmtDate(entry.completed_at)} — mark unwatched
              </button>
            ) : (
              <button className="btn primary wide" onClick={() => act(() => api.complete(id, 'WATCHED', true), 'Marked watched')}>
                Mark as watched
              </button>
            )}
            {media.runtime_min && <div className="muted sm">Runtime {fmtMinutes(media.runtime_min)}</div>}
          </section>
        )}
        {d.movie && <MovieRatingsPanel d={d} act={act} />}

        <PersonalPanel d={d} act={act} />
        <MetadataEditor d={d} act={act} />
        <History d={d} act={act} />

        <section className="insp-section row gap wrap">
          {entry.archived_at ? (
            <>
              <button className="btn ghost sm" onClick={() => act(() => api.archive(id, false), 'Restored from archive')}>
                Restore from archive
              </button>
              <DeleteForever d={d} />
            </>
          ) : (
            <button className="btn ghost sm" onClick={() => act(() => api.archive(id, true), 'Archived')}>
              Archive
            </button>
          )}
        </section>
      </div>
    </aside>
  );
}

type Act = (fn: () => Promise<MutationResult>, message?: string) => Promise<MutationResult | null>;

function InspectorHead({ onClose }: { onClose: () => void }) {
  return (
    <div className="insp-head">
      <button className="icon-btn" onClick={onClose} aria-label="Close details">
        <CloseIcon />
      </button>
    </div>
  );
}

function SourceLine({ label, source, url, checked }: { label: string; source: string | null; url: string | null; checked: string | null }) {
  return (
    <div className="source-line">
      {label}: {source === 'MANUAL' || !source ? 'manual entry' : source}
      {checked && ` · checked ${fmtDate(checked)}`}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">
          source <ExternalIcon />
        </a>
      )}
    </div>
  );
}

// ---------------- games ----------------

// D-07: IGDB's "normally" figure fills Normal; the other two are optional manual entries.
const TIME_LABEL: Record<TimeCategory, string> = { NORMAL: 'Normal', STORY: 'Story only', COMPLETIONIST: 'Completionist' };
const TIME_ORDER: TimeCategory[] = ['NORMAL', 'STORY', 'COMPLETIONIST'];

const yesNo = (v: boolean | null | undefined) => (v == null ? '—' : v ? 'Yes' : 'No');

function GamePanel({ d, act }: { d: EntryDetail; act: Act }) {
  const { notify } = useApp();
  const { entry, media } = d;
  const g = d.game!;
  const id = entry.id;
  const stack = g.trophies[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [igdbBusy, setIgdbBusy] = useState(false);

  return (
    <>
      <section className="insp-section">
        <h3 className="h-sub">PLAYING ON</h3>
        {media.platforms.length ? (
          <div className="seg fit" role="radiogroup" aria-label="Platform you will play on">
            {media.platforms.map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={entry.play_platform === p}
                className={entry.play_platform === p ? 'on' : ''}
                onClick={() => entry.play_platform !== p && act(() => api.setPlayPlatform(id, p), `Playing on ${p}`)}
              >
                {p}
              </button>
            ))}
          </div>
        ) : (
          <div className="muted sm">No platforms listed — add them under Edit details.</div>
        )}
        <div className="muted sm">Trophy stats follow the version you play.</div>
      </section>

      <section className="insp-section">
        <div className="row between">
          <h3 className="h-sub">PLAYTIME</h3>
          {g.igdb_linked && (
            <button
              className="btn ghost xs"
              disabled={igdbBusy}
              onClick={async () => {
                setIgdbBusy(true);
                const r = (await act(() => api.igdbTime(id))) as (MutationResult & { message?: string }) | null;
                if (r?.message) notify(r.message);
                setIgdbBusy(false);
              }}
            >
              {igdbBusy ? '…' : '↻ IGDB time'}
            </button>
          )}
        </div>
        {TIME_ORDER.map((c) => (
          <TimeRow key={c} category={c} d={d} act={act} />
        ))}
      </section>

      <section className="insp-section">
        <h3 className="h-sub">COMPLETION</h3>
        <div className="row gap wrap">
          <Toggle
            on={!!entry.story_completed_at}
            label="Story completed"
            when={entry.story_completed_at}
            onClick={() => act(() => api.complete(id, 'STORY', !entry.story_completed_at), entry.story_completed_at ? 'Story completion cleared' : 'Story completed')}
          />
          {g.platinum_applicable && (
            <Toggle
              on={!!entry.platinum_earned_at}
              label="Platinum earned"
              when={entry.platinum_earned_at}
              onClick={() => act(() => api.complete(id, 'PLATINUM', !entry.platinum_earned_at), entry.platinum_earned_at ? 'Platinum cleared' : 'Platinum earned')}
            />
          )}
        </div>
      </section>

      <section className="insp-section trophy">
        <div className="row between">
          <h3 className="h-sub">
            <TrophyIcon size={16} /> TROPHY GUIDE{g.play_ps ? ` · ${g.play_ps}` : ''}
          </h3>
          {g.platinum_applicable && !editing && (
            <button className="btn ghost sm" onClick={() => setEditing(true)}>
              {stack ? 'Edit' : '+ Enter manually'}
            </button>
          )}
        </div>
        {!g.platinum_applicable ? (
          <div className="muted sm">
            Platinum: not applicable — you’re playing on {entry.play_platform ?? 'a non-PlayStation platform'}.
            {isAnyPs(media.platforms) && ' Switch “Playing on” to a PlayStation version to track trophies.'}
          </div>
        ) : (
          <>
            <TrophyJobStatus d={d} act={act} />
            {!stack && !editing && g.trophy_job?.status !== 'RUNNING' && <div className="muted sm">Platinum: unknown — no guide values recorded for {g.play_ps}.</div>}
            {stack && !editing && <TrophyCard t={stack} onRemove={() => act(() => api.deleteTrophy(id, stack.id), 'Trophy values removed')} />}
            {editing && <TrophyForm d={d} initial={stack} onDone={() => setEditing(false)} act={act} />}
            <button
              className="btn primary wide"
              disabled={refreshing || g.trophy_job?.status === 'RUNNING'}
              onClick={async () => {
                setRefreshing(true);
                await act(() => api.trophyRefresh(id));
                setRefreshing(false);
              }}
            >
              {refreshing || g.trophy_job?.status === 'RUNNING' ? 'Searching guides…' : '↻ Refresh Trophy Data'}
            </button>
          </>
        )}
      </section>
    </>
  );
}

const isAnyPs = (platforms: string[]) => platforms.some((p) => /^(PS\s?\d|PS\s?VITA|VITA|PLAYSTATION)/i.test(p));

function TrophyCard({ t, onRemove }: { t: TrophyGuide; onRemove: () => void }) {
  return (
    <div className="trophy-card">
      <div className="row between">
        <span className={`pill ${t.platinum === 'YES' ? 'good' : ''}`}>{t.platinum === 'YES' ? 'Has Platinum' : t.platinum === 'NO' ? 'No Platinum' : 'Platinum unknown'}</span>
        <span className={`pill ${t.user_locked ? '' : 'auto'}`} title={t.user_locked ? 'Entered or edited by you; lookups never overwrite it without asking' : 'Filled automatically from a guide summary'}>
          {t.user_locked ? 'Manual' : 'Auto'}
        </span>
      </div>
      <div className="trophy-stats">
        <div>
          <div className="big">{fmtRange(t.hours_min, t.hours_max, ' hours')}</div>
          <div className="eyebrow muted">EST. PLATINUM TIME</div>
        </div>
        <div>
          <div className="big">{t.difficulty_min == null && t.difficulty_max == null ? '—' : fmtRange(t.difficulty_min, t.difficulty_max, ' / 10')}</div>
          <div className="eyebrow muted">DIFFICULTY</div>
        </div>
      </div>
      <DifficultyBar min={t.difficulty_min} max={t.difficulty_max} />
      {t.difficulty_text && <div className="sm muted">“{t.difficulty_text}”</div>}
      <dl className="facts">
        <dt>Playthroughs</dt>
        <dd>{t.playthroughs ?? '—'}</dd>
        <dt>Online trophies</dt>
        <dd>{yesNo(t.online_required)}</dd>
        <dt>Missables</dt>
        <dd>{yesNo(t.missables)}</dd>
      </dl>
      {t.notes && <p className="sm">{t.notes}</p>}
      <SourceLine label="Source" source={t.source} url={t.guide_url} checked={t.checked_at} />
      <div>
        <ConfirmButton confirm="Remove values" onConfirm={onRemove}>
          Remove
        </ConfirmButton>
      </div>
    </div>
  );
}

/** Shows what the latest SearXNG lookup did: running, failed, nothing found (with guide links), a diff to review, or an applied fill with revert. */
function TrophyJobStatus({ d, act }: { d: EntryDetail; act: Act }) {
  const job = d.game!.trophy_job;
  const stack = d.game!.trophies[0] ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!job || dismissed === job.id) return null;
  const best = job.candidates.find((c) => c.accepted);

  if (job.status === 'RUNNING') return <div className="notice">Searching trophy guides for {job.platform}…</div>;
  if (job.status === 'ERROR') return <div className="notice error">Trophy lookup failed: {job.error}</div>;
  if (job.status === 'NOT_FOUND') {
    const guides = job.candidates.filter((c) => /guide|roadmap/i.test(c.title)).slice(0, 4);
    return (
      <div className="notice">
        No guide summary gave hours or difficulty for {job.platform}.{guides.length > 0 && ' Guides found — open one and enter the values:'}
        {guides.length > 0 && (
          <ul className="cand-list">
            {guides.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.site}: {c.title} ↗
                </a>
                <span className="muted sm"> — {c.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const p = job.proposal;
  if (!p) return null;

  if (job.status === 'NEEDS_REVIEW' && (!job.applied_at || job.reverted_at)) {
    const rows: [string, string, string][] = [
      ['Platinum time', fmtRange(stack?.hours_min, stack?.hours_max, 'h'), fmtRange(p.hours_min, p.hours_max, 'h')],
      ['Difficulty', fmtRange(stack?.difficulty_min, stack?.difficulty_max, '/10'), fmtRange(p.difficulty_min, p.difficulty_max, '/10')],
      ['Playthroughs', String(stack?.playthroughs ?? '—'), String(p.playthroughs ?? '—')],
      ['Online trophies', yesNo(stack?.online_required), yesNo(p.online_required)],
      ['Missables', yesNo(stack?.missables), yesNo(p.missables)],
    ];
    return (
      <div className="review">
        <div className="eyebrow">REVIEW CHANGES · {p.source}</div>
        <table className="diff-table">
          <thead>
            <tr>
              <th />
              <th>Now</th>
              <th>Guide</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, now, next]) => (
              <tr key={label} className={next !== '—' && now !== next ? 'changed' : ''}>
                <td>{label}</td>
                <td>{now}</td>
                <td>{next}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {best && <Evidence url={best.url} excerpt={best.excerpt} />}
        <div className="row gap">
          <button className="btn primary sm" onClick={() => act(() => api.applyTrophyJob(job.id), 'Guide values applied')}>
            Apply
          </button>
          <button className="btn ghost sm" onClick={() => setDismissed(job.id)}>
            Keep current
          </button>
        </div>
      </div>
    );
  }

  if (job.applied_at && !job.reverted_at) {
    return (
      <div className="auto-line">
        <span>
          {job.status === 'PARTIAL' ? 'Partly filled' : 'Filled'} from {p.source} · {fmtDate(job.applied_at)}
        </span>
        <ConfirmButton confirm="Revert" onConfirm={() => act(() => api.revertTrophyJob(job.id), 'Trophy values reverted')} className="btn ghost xs">
          Revert
        </ConfirmButton>
        {best && <Evidence url={best.url} excerpt={best.excerpt} />}
      </div>
    );
  }
  return null;
}

function Evidence({ url, excerpt }: { url: string; excerpt: string }) {
  return (
    <details className="evidence">
      <summary className="sm">Where these numbers came from</summary>
      <blockquote className="sm">{excerpt}</blockquote>
      <a className="sm" href={url} target="_blank" rel="noopener noreferrer">
        Open the guide ↗
      </a>
    </details>
  );
}


function Toggle({ on, label, when, onClick }: { on: boolean; label: string; when: string | null; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="box" aria-hidden="true">
        {on ? '✓' : ''}
      </span>
      <span>
        {label}
        {when && <span className="muted sm block">{fmtDate(when)}</span>}
      </span>
    </button>
  );
}

function TimeRow({ category, d, act }: { category: TimeCategory; d: EntryDetail; act: Act }) {
  const t = d.game!.times.find((x) => x.category === category);
  const [edit, setEdit] = useState(false);
  const [hours, setHours] = useState(t?.hours?.toString() ?? '');
  const [source, setSource] = useState(t?.source ?? '');
  const [url, setUrl] = useState(t?.source_url ?? '');
  if (edit) {
    return (
      <form
        className="time-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => api.setTime(d.entry.id, { category, hours: hours === '' ? null : Number(hours), source: source || null, source_url: url || null }));
          if (r) setEdit(false);
        }}
      >
        <span className="lbl">{TIME_LABEL[category]}</span>
        <input className="input xs" type="number" min="0" step="0.5" placeholder="hours" value={hours} onChange={(e) => setHours(e.target.value)} aria-label={`${TIME_LABEL[category]} hours`} autoFocus />
        <input className="input" placeholder="Source (e.g. HowLongToBeat)" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source name" />
        <input className="input" placeholder="https:// source link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Source link" />
        <div className="row gap">
          <button className="btn primary sm">Save</button>
          <button type="button" className="btn ghost sm" onClick={() => setEdit(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }
  return (
    <button className="kv editable" onClick={() => setEdit(true)} aria-label={`Edit ${TIME_LABEL[category]} hours`}>
      <span className="lbl">{TIME_LABEL[category]}</span>
      <span>
        {t ? `${fmtHours(t.hours)}` : <span className="muted">Unknown</span>}
        {t?.source && <span className="muted sm"> · {t.source}</span>}
      </span>
    </button>
  );
}

function TrophyForm({ d, initial, onDone, act }: { d: EntryDetail; initial: TrophyGuide | null; onDone: () => void; act: Act }) {
  // D-05: values are always recorded for the version being played; regions are not tracked.
  const platform = d.game!.play_ps!;
  const [f, setF] = useState({
    playthroughs: initial?.playthroughs?.toString() ?? '',
    hours_min: initial?.hours_min?.toString() ?? '',
    hours_max: initial?.hours_max?.toString() ?? '',
    difficulty_min: initial?.difficulty_min?.toString() ?? '',
    difficulty_max: initial?.difficulty_max?.toString() ?? '',
    guide_url: initial?.guide_url ?? '',
    notes: initial?.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (v: string) => (v === '' ? null : Number(v));
  return (
    <form
      className="trophy-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act(
          () =>
            api.setTrophy(d.entry.id, {
              platform,
              region: 'ALL',
              // Not editable here: keep whatever is already recorded (unknown for a new stack).
              platinum: initial?.platinum ?? 'UNKNOWN',
              hours_min: n(f.hours_min),
              hours_max: n(f.hours_max),
              difficulty_min: n(f.difficulty_min),
              difficulty_max: n(f.difficulty_max),
              difficulty_text: initial?.difficulty_text ?? null,
              playthroughs: n(f.playthroughs),
              online_required: initial?.online_required ?? null,
              missables: initial?.missables ?? null,
              guide_url: f.guide_url || null,
              source: initial?.source ?? null,
              notes: f.notes,
            }),
          `${platform} trophy values saved`,
        );
        if (r) onDone();
      }}
    >
      <div className="muted sm">Saving marks these values as yours: lookups will propose changes but never overwrite them silently.</div>
      <label>
        Playthroughs
        <input className="input" type="number" min="0" value={f.playthroughs} onChange={set('playthroughs')} />
      </label>
      <div className="grid2">
        <label>
          Hours min
          <input className="input" type="number" min="0" step="0.5" value={f.hours_min} onChange={set('hours_min')} />
        </label>
        <label>
          Hours max
          <input className="input" type="number" min="0" step="0.5" value={f.hours_max} onChange={set('hours_max')} />
        </label>
        <label>
          Difficulty min /10
          <input className="input" type="number" min="0" max="10" step="0.5" value={f.difficulty_min} onChange={set('difficulty_min')} />
        </label>
        <label>
          Difficulty max /10
          <input className="input" type="number" min="0" max="10" step="0.5" value={f.difficulty_max} onChange={set('difficulty_max')} />
        </label>
      </div>
      <label>
        Guide link
        <input className="input" value={f.guide_url} onChange={set('guide_url')} placeholder="https://" />
      </label>
      <label>
        Notes
        <textarea className="input" rows={2} value={f.notes} onChange={set('notes')} />
      </label>
      <div className="row gap">
        <button className="btn primary sm">Save stack</button>
        <button type="button" className="btn ghost sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------- tv ----------------

function MovieRatingsPanel({ d, act }: { d: EntryDetail; act: Act }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const { imdb, rt_audience: rt } = d.movie!.ratings;
  return (
    <section className="insp-section">
      <div className="row between">
        <h3 className="h-sub">RATINGS</h3>
        <button
          className="btn ghost sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = (await act(() => api.refreshMovieRatings(d.entry.id))) as (MutationResult & { errors?: string[] }) | null;
            if (r) notify(r.errors?.length ? r.errors.join(' · ') : 'Ratings refreshed', { error: !!r.errors?.length });
            setBusy(false);
          }}
        >
          {busy ? '…' : '↻ Refresh'}
        </button>
      </div>
      <dl className="facts">
        <dt>IMDb</dt>
        <dd>
          {imdb ? (
            <>
              {imdb.score.toFixed(1)} / 10 {imdb.votes ? <span className="muted sm">({imdb.votes.toLocaleString()} votes)</span> : null}{' '}
              {imdb.url && (
                <a href={imdb.url} target="_blank" rel="noreferrer noopener" aria-label="Open on IMDb">
                  <ExternalIcon />
                </a>
              )}
            </>
          ) : (
            <span className="muted">Unavailable</span>
          )}
        </dd>
        <dt>RT audience</dt>
        <dd>
          {rt ? (
            <>
              🍿 {rt.score}% {rt.label && <span className="muted sm">({rt.label})</span>}{' '}
              {rt.url && (
                <a href={rt.url} target="_blank" rel="noreferrer noopener" aria-label="Open on Rotten Tomatoes">
                  <ExternalIcon />
                </a>
              )}
            </>
          ) : (
            <span className="muted">Unavailable</span>
          )}
        </dd>
      </dl>
      {d.movie!.attribution.map((a) => (
        <div key={a} className="source-line">
          {a}
        </div>
      ))}
    </section>
  );
}

function TvPanel({ d, act }: { d: EntryDetail; act: Act }) {
  const tv = d.tv!;
  const id = d.entry.id;
  const regular = tv.seasons.filter((s) => !s.is_special);
  const [seasonId, setSeasonId] = useState<string | null>(regular[0]?.id ?? tv.seasons[0]?.id ?? null);
  const [heatmap, setHeatmap] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const season = tv.seasons.find((s) => s.id === seasonId) ?? tv.seasons[0];
  const p = tv.progress;
  const linked = d.media.metadata_source === 'TVMAZE';

  return (
    <section className="insp-section">
      <div className="row between">
        <h3 className="h-sub">EPISODES</h3>
        <div className="row gap">
          {tv.seasons.length > 0 && (
            <button className="btn ghost sm" onClick={() => setHeatmap(true)}>
              ▦ Heatmap
            </button>
          )}
          {linked && (
            <button
              className="btn ghost sm"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                await act(() => api.syncTv(id), 'Episode list refreshed from TVmaze');
                setSyncing(false);
              }}
            >
              {syncing ? '…' : '↻ Sync'}
            </button>
          )}
        </div>
      </div>
      {tv.seasons.length === 0 ? (
        <div className="muted sm">No episode data. {linked ? 'Try Sync.' : 'Manual shows get episodes when added with season counts.'}</div>
      ) : (
        <>
          <div className="tv-progress">
            <div className="progress-bar lg" aria-hidden="true">
              <i style={{ width: `${pct(p.watched, p.eligible)}%` }} />
            </div>
            <div className="sm">
              {p.watched}/{p.eligible} released episodes · {fmtMinutes(p.watched_minutes)} watched · {fmtMinutes(p.remaining_minutes)} left
              {p.runtime_estimated && <span className="muted"> (estimated)</span>}
              {p.unreleased > 0 && <span className="muted"> · {p.unreleased} upcoming</span>}
              {p.specials_watched > 0 && <span className="muted"> · {p.specials_watched} specials</span>}
            </div>
          </div>
          {p.suggest_complete && (
            <div className="notice row between">
              <span>All released episodes watched.</span>
              <button className="btn primary sm" onClick={() => act(() => api.complete(id, 'SERIES', true), 'Series marked completed')}>
                Mark series completed
              </button>
            </div>
          )}
          <div className="season-tabs" role="tablist" aria-label="Seasons">
            {tv.seasons.map((s) => (
              <button key={s.id} role="tab" aria-selected={s.id === season?.id} className={s.id === season?.id ? 'on' : ''} onClick={() => setSeasonId(s.id)}>
                {s.is_special ? 'Specials' : `S${s.number}`}
                {!s.is_special && s.eligible > 0 && s.watched === s.eligible && <span aria-label="complete"> ✓</span>}
              </button>
            ))}
          </div>
          {season && (
            <>
              <div className="row between">
                <span className="muted sm">
                  {season.is_special ? 'Specials are excluded from progress' : `${season.watched}/${season.eligible} watched`}
                </span>
                {!season.is_special && (
                  <span className="row gap">
                    {season.watched < season.eligible && (
                      <ConfirmButton confirm={`Mark ${season.eligible - season.watched} watched`} onConfirm={() => act(() => api.watchSeason(id, season.number, true), `Season ${season.number} marked watched`)}>
                        Mark season watched
                      </ConfirmButton>
                    )}
                    {season.watched > 0 && (
                      <ConfirmButton confirm="Clear season" onConfirm={() => act(() => api.watchSeason(id, season.number, false), `Season ${season.number} cleared`)}>
                        Clear
                      </ConfirmButton>
                    )}
                  </span>
                )}
              </div>
              <ol className="episodes">
                {season.episodes.map((e) => (
                  <li key={e.id} className={e.released ? '' : 'unreleased'}>
                    <label>
                      <input
                        type="checkbox"
                        checked={e.watched}
                        disabled={!e.released && !e.watched}
                        onChange={() => act(() => api.watchEpisode(id, e.id, !e.watched), `${season.is_special ? 'Special' : `S${season.number}`}E${e.number} ${e.watched ? 'unwatched' : 'watched'}`)}
                      />
                      <span className="ep-num">E{e.number}</span>
                      <span className="ep-title">{e.title ?? `Episode ${e.number}`}</span>
                    </label>
                    <span className="muted sm">{e.released ? fmtDate(e.airdate) : e.airdate ? `Airs ${fmtDate(e.airdate)}` : 'TBA'}</span>
                    {e.rating && <span className="ep-rating" title={`${e.rating.provider} rating`}>{e.rating.score.toFixed(1)}</span>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {regular.length > 1 && p.watched < p.eligible && (
            <ConfirmButton confirm={`Mark all ${p.eligible - p.watched} watched`} onConfirm={() => act(() => api.watchSeason(id, 'all', true), 'All released episodes marked watched')} className="btn ghost sm wide">
              Mark every released episode watched
            </ConfirmButton>
          )}
        </>
      )}
      {heatmap && <Heatmap d={d} act={act} onClose={() => setHeatmap(false)} />}
    </section>
  );
}

// ---------------- books ----------------

function BookPanel({ d, act }: { d: EntryDetail; act: Act }) {
  const ed = d.book!.edition;
  const id = d.entry.id;
  const [page, setPage] = useState(d.entry.current_page ?? 0);
  const [editPages, setEditPages] = useState(false);
  const [pages, setPages] = useState(ed.pages?.toString() ?? '');
  const [isbn, setIsbn] = useState(ed.isbn ?? '');
  useEffect(() => setPage(d.entry.current_page ?? 0), [d.entry.current_page]);

  const savePage = (v: number) => v !== (d.entry.current_page ?? 0) && act(() => api.patch(id, { version: d.entry.version, current_page: v }), `Page ${v}`);

  return (
    <section className="insp-section">
      <h3 className="h-sub">READING</h3>
      {editPages ? (
        <form
          className="row gap wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(() => api.setEdition(id, { pages: pages ? Number(pages) : null, isbn: isbn || null }));
            if (r) setEditPages(false);
          }}
        >
          <input className="input xs" type="number" min="1" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="pages" aria-label="Pages in your edition" autoFocus />
          <input className="input" value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="ISBN (optional)" aria-label="ISBN" />
          <button className="btn primary sm">Save</button>
        </form>
      ) : (
        <button className="kv editable" onClick={() => setEditPages(true)}>
          <span className="lbl">Edition pages</span>
          <span>
            {ed.pages ?? <span className="muted">Unknown</span>}
            {ed.isbn && <span className="muted sm"> · ISBN {ed.isbn}</span>}
          </span>
        </button>
      )}
      {ed.pages_source && <div className="source-line">Pages: {ed.pages_source}</div>}
      {ed.pages ? (
        <div className="page-ctl">
          <input
            type="range"
            min={0}
            max={ed.pages}
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
            onMouseUp={() => savePage(page)}
            onKeyUp={() => savePage(page)}
            onTouchEnd={() => savePage(page)}
            aria-label="Current page"
          />
          <input className="input xs" type="number" min={0} max={ed.pages} value={page} onChange={(e) => setPage(Number(e.target.value))} onBlur={() => savePage(page)} aria-label="Current page number" />
          <span className="sm">/ {ed.pages} · {pct(page, ed.pages)}%</span>
        </div>
      ) : (
        <div className="muted sm">Set your edition’s page count to track progress.</div>
      )}
      {d.entry.status === 'COMPLETED' ? (
        <button className="btn ghost" onClick={() => act(() => api.complete(id, 'FINISHED', false), 'Reopened')}>
          ✓ Finished {fmtDate(d.entry.completed_at)} — reopen
        </button>
      ) : (
        <button className="btn primary wide" onClick={() => act(() => api.complete(id, 'FINISHED', true), 'Finished reading')}>
          Mark finished
        </button>
      )}
    </section>
  );
}

// ---------------- shared panels ----------------

function PersonalPanel({ d, act }: { d: EntryDetail; act: Act }) {
  const { entry } = d;
  const [notes, setNotes] = useState(entry.notes);
  useEffect(() => setNotes(entry.notes), [entry.notes]);
  const patch = (body: Record<string, unknown>, msg: string) => act(() => api.patch(entry.id, { version: entry.version, ...body }), msg);
  return (
    <section className="insp-section">
      <h3 className="h-sub">MINE</h3>
      <div className="kv">
        <span className="lbl">My rating</span>
        <span className="stars" role="group" aria-label="My rating out of 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button key={n} className={entry.personal_rating != null && n <= entry.personal_rating ? 'on' : ''} aria-label={`${n} out of 10`} aria-pressed={entry.personal_rating === n} onClick={() => patch({ personal_rating: entry.personal_rating === n ? null : n }, entry.personal_rating === n ? 'Rating cleared' : `Rated ${n}/10`)}>
              ★
            </button>
          ))}
          <span className="sm">{entry.personal_rating != null ? `${entry.personal_rating}/10` : '—'}</span>
        </span>
      </div>
      <div className="kv">
        <span className="lbl">Priority</span>
        <span className="seg mini">
          {['None', 'Low', 'Med', 'High'].map((l, i) => (
            <button key={l} className={entry.priority === i ? 'on' : ''} aria-pressed={entry.priority === i} onClick={() => entry.priority !== i && patch({ priority: i }, `Priority ${l}`)}>
              {l}
            </button>
          ))}
        </span>
      </div>
      <label className="kv">
        <span className="lbl">Owned</span>
        <input type="checkbox" checked={entry.owned} onChange={(e) => patch({ owned: e.target.checked }, e.target.checked ? 'Marked owned' : 'Marked not owned')} />
      </label>
      <label className="block">
        <span className="lbl">Notes</span>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== entry.notes && patch({ notes }, 'Notes saved')} placeholder="Private notes…" />
      </label>
    </section>
  );
}

function MetadataEditor({ d, act }: { d: EntryDetail; act: Act }) {
  const m = d.media;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    title: m.title,
    year: m.year?.toString() ?? '',
    platforms: m.platforms.join(', '),
    genres: m.genres.join(', '),
    creator: m.creator ?? '',
    runtime_min: m.runtime_min?.toString() ?? '',
    cover_url: m.cover_url ?? '',
    synopsis: m.synopsis ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <details className="insp-section" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="h-sub">EDIT DETAILS</summary>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(
            () =>
              api.patchMedia(d.entry.id, {
                title: f.title,
                year: f.year ? Number(f.year) : null,
                platforms: list(f.platforms),
                genres: list(f.genres),
                creator: f.creator || null,
                runtime_min: f.runtime_min ? Number(f.runtime_min) : null,
                cover_url: f.cover_url || null,
                synopsis: f.synopsis || null,
              }),
            'Details saved',
          );
          if (r) setOpen(false);
        }}
      >
        <label>
          Title
          <input className="input" value={f.title} onChange={set('title')} required maxLength={300} />
        </label>
        <div className="grid2">
          <label>
            Year
            <input className="input" type="number" value={f.year} onChange={set('year')} />
          </label>
          <label>
            {m.type === 'BOOK' ? 'Author' : m.type === 'GAME' ? 'Developer' : m.type === 'TV' ? 'Network' : 'Director'}
            <input className="input" value={f.creator} onChange={set('creator')} />
          </label>
        </div>
        {m.type === 'GAME' && (
          <label>
            Platforms (comma separated)
            <input className="input" value={f.platforms} onChange={set('platforms')} placeholder="PS5, PS4, PC" />
          </label>
        )}
        <label>
          Genres (comma separated)
          <input className="input" value={f.genres} onChange={set('genres')} />
        </label>
        {(m.type === 'MOVIE' || m.type === 'TV') && (
          <label>
            {m.type === 'TV' ? 'Typical episode runtime (min)' : 'Runtime (min)'}
            <input className="input" type="number" value={f.runtime_min} onChange={set('runtime_min')} />
          </label>
        )}
        <label>
          Cover image URL
          <input className="input" value={f.cover_url} onChange={set('cover_url')} placeholder="https://" />
        </label>
        <label>
          Synopsis
          <textarea className="input" rows={3} value={f.synopsis} onChange={set('synopsis')} />
        </label>
        <button className="btn primary sm">Save details</button>
      </form>
    </details>
  );
}

function History({ d, act }: { d: EntryDetail; act: Act }) {
  return (
    <details className="insp-section">
      <summary className="h-sub">HISTORY ({d.events.length})</summary>
      <ol className="history">
        {d.events.map((e) => (
          <li key={e.id} className={e.undone_at ? 'undone' : ''}>
            <span>{e.summary}</span>
            <span className="muted sm">{fmtDateTime(e.occurred_at)}</span>
            {e.undoable && (
              <button className="btn ghost xs" onClick={() => act(() => api.undo(e.id), 'Change undone')}>
                Undo
              </button>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

function DeleteForever({ d }: { d: EntryDetail }) {
  const { select, bump, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  if (!open)
    return (
      <button className="btn danger-ghost sm" onClick={() => setOpen(true)}>
        Delete permanently…
      </button>
    );
  return (
    <form
      className="delete-box"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.remove(d.entry.id, typed);
          notify(`“${d.media.title}” deleted permanently`);
          select(null);
          bump();
        } catch (err) {
          notify((err as ApiError).message, { error: true });
        }
      }}
    >
      <p className="sm">This cannot be undone. Progress, notes and history for this entry will be erased. Type the title to confirm.</p>
      <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the title to confirm" placeholder={d.media.title} />
      <div className="row gap">
        <button className="btn danger sm" disabled={typed !== d.media.title}>
          Delete forever
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
