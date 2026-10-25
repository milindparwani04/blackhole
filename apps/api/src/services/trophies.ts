import type { PsPlatform, TrophyCandidate, TrophyJob, TrophyProposal } from '../../../../packages/shared/src/index.js';
import { all, get, nowIso, run, tx, uuid, type DB } from '../db/db.js';
import { searx, type SearxResult } from '../adapters/searxng.js';
import { fetchGuidePage, htmlToText, roadmapBox } from '../adapters/guidepage.js';
import { AppError } from '../security/errors.js';

/** Guide sites whose snippets we parse, in order of preference. Search results from other sites are ignored. */
export const GUIDE_SITES: { domain: string; name: string }[] = [
  { domain: 'powerpyx.com', name: 'PowerPyx' },
  { domain: 'psnprofiles.com', name: 'PSNProfiles' },
  { domain: 'playstationtrophies.org', name: 'PlayStationTrophies' },
  { domain: 'knoef.info', name: 'Knoef' },
];

// ---------------- parsing ----------------

const num = (s: string | undefined) => (s === undefined ? null : Number(s));

/**
 * Extracts guide values from untrusted snippet text. Only numbers in a recognised context are accepted;
 * anything else in the text (including instructions) is ignored.
 */
export function parseGuideText(raw: string): TrophyProposal {
  const text = raw.replace(/\s+/g, ' ');
  const p: TrophyProposal = {
    hours_min: null,
    hours_max: null,
    difficulty_min: null,
    difficulty_max: null,
    difficulty_text: null,
    playthroughs: null,
    online_required: null,
    missables: null,
    mentions_platinum: /platinum/i.test(text),
  };

  // Difficulty: "difficulty: 5/10", "difficulty 4-5/10", "5/10 difficulty", "1/10 with guide, 3/10 without".
  // Labelled values only ("Estimated trophy difficulty: 5/10", "Platinum difficulty 4-5/10", "Difficulty: 6/10") —
  // snippets often include reader comments, whose numbers must not be mistaken for the guide's rating.
  const LABEL = String.raw`(?:(?:estimated\s+)?(?:trophy|platinum)\s+difficulty|difficulty\s*:)`;
  const d1 = new RegExp(String.raw`${LABEL}[^0-9/]{0,25}?(\d{1,2}(?:\.\d)?)\s*(?:[-–]|to)\s*(\d{1,2}(?:\.\d)?)\s*\/\s*10|${LABEL}[^0-9/]{0,25}?(\d{1,2}(?:\.\d)?)\s*\/\s*10`, 'i').exec(text);
  const d2 = /(\d{1,2}(?:\.\d)?)\s*\/\s*10\s+difficulty/i.exec(text);
  // PlayStationTrophies omits the "/10": "Estimated Trophy Difficulty: 4.5 ·" (their scale is out of 10).
  const d3 = /estimated\s+trophy\s+difficulty\s*:?\s*(\d{1,2}(?:\.\d)?)(?!\s*\/\s*\d)(?![\d.])/i.exec(text);
  const withWithout = /(\d{1,2}(?:\.\d)?)\s*\/\s*10\s+with(?:out)?\s+(?:a\s+)?guide[^0-9]{0,30}(\d{1,2}(?:\.\d)?)\s*\/\s*10\s+with(?:out)?/i.exec(text);
  if (withWithout) {
    const a = Number(withWithout[1]);
    const b = Number(withWithout[2]);
    [p.difficulty_min, p.difficulty_max] = [Math.min(a, b), Math.max(a, b)];
    p.difficulty_text = withWithout[0].slice(0, 120);
  } else if (d1) {
    p.difficulty_min = num(d1[1] ?? d1[3]);
    p.difficulty_max = num(d1[2] ?? d1[3]);
    p.difficulty_text = d1[0].slice(0, 120);
  } else if (d2) {
    p.difficulty_min = p.difficulty_max = Number(d2[1]);
    p.difficulty_text = d2[0];
  } else if (d3) {
    p.difficulty_min = p.difficulty_max = Number(d3[1]);
    p.difficulty_text = `${d3[0]}/10`;
  }
  if ((p.difficulty_max ?? 0) > 10 || (p.difficulty_min ?? 0) > 10) p.difficulty_min = p.difficulty_max = p.difficulty_text = null;

  // Hours: only accept a number of hours whose preceding context talks about platinum/100%/trophies.
  // The lookbehind stops clock times ("under 5:00 hours") and decimals from being read as a number of hours.
  const hourRe = /(?<![\d:.])(\d{1,4})(?:\s*(?:[-–]|to)\s*(\d{1,4}))?\s*\+?\s*(?:hours|hrs|h)\b/gi;
  for (let m: RegExpExecArray | null; (m = hourRe.exec(text)); ) {
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (Number(m[1]) === 0) continue;
    // Labelled estimate before ("Approximate amount of time to platinum: 60-80 hours") or after ("30-40 hours (Estimated Time to Platinum)").
    const labelledBefore = /(?:time\s+to\s+(?:platinum|\/?\s*100\s?%)|amount\s+of\s+time|time\s+to\s+plat|estimated\s+time|platinum\s+time|hours\s+to\s+platinum)[^0-9]{0,25}$/i.test(before);
    const labelledAfter = /^\s*\(?\s*(?:estimated\s+)?time\s+to\s+(?:platinum|100\s?%)/i.test(after);
    if (labelledBefore || labelledAfter) {
      p.hours_min = Number(m[1]);
      p.hours_max = m[2] ? Number(m[2]) : Number(m[1]);
      if (p.hours_min > p.hours_max) [p.hours_min, p.hours_max] = [p.hours_max, p.hours_min];
      break;
    }
  }

  const pt = /(?:minimum\s+(?:number\s+of\s+)?)?playthroughs?(?:\s+required)?\s*[:-]?\s*(\d{1,2})\b/i.exec(text) ?? /\b(\d{1,2})\s+playthroughs?\b/i.exec(text);
  if (pt) p.playthroughs = Number(pt[1]);

  const online = /online\s+trophies\s*[:-]?\s*(\d{1,3})/i.exec(text);
  if (online) p.online_required = Number(online[1]) > 0;
  else if (/no\s+online\s+trophies|offline\s+only/i.test(text)) p.online_required = false;

  const miss = /missable\s+trophies\s*[:-]?\s*(\d{1,3})/i.exec(text) ?? /number\s+of\s+missable[^:0-9]{0,20}[:-]?\s*(\d{1,3})/i.exec(text);
  if (miss) p.missables = Number(miss[1]) > 0;
  else if (/no\s+missable/i.test(text)) p.missables = false;

  return p;
}

// ---------------- matching ----------------

export const normalizeTitle = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Ragnarök → Ragnarok
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Only real guide pages count — not forum threads (individual opinions) or trophy lists. */
const GUIDE_PATH: Record<string, RegExp> = {
  'powerpyx.com': /trophy-guide/i,
  'psnprofiles.com': /^\/guide\//i,
  'playstationtrophies.org': /^\/game\/[^/]+\/guide\/?$/i,
  'knoef.info': /trophy|guide/i,
};

/** Strips the site's suffix ("Trophy Guide & Roadmap", "• PSNProfiles.com") and platform/year tags to leave the game name. */
export function guideGameName(resultTitle: string): { name: string; platform: PsPlatform | null; year: number | null } {
  const year = /\((\d{4})\)/.exec(resultTitle);
  const platform = /\bPS5\b/i.test(resultTitle) && !/\bPS4\b/i.test(resultTitle) ? 'PS5' : /\bPS4\b/i.test(resultTitle) && !/\bPS5\b/i.test(resultTitle) ? 'PS4' : /\bPS3\b/i.test(resultTitle) ? 'PS3' : /\bVita\b/i.test(resultTitle) ? 'PSVITA' : null;
  const name = resultTitle
    .split(/\s+(?:trophy|trophies)\s+(?:guide|list|roadmap)|\s+platinum\s+(?:guide|walkthrough)|\s+[-–|•·]\s+/i)[0]
    .replace(/\((?:PS[345]|PS ?Vita|PS4\s*\/\s*PS5|PS5\s*\/\s*PS4)[^)]*\)/gi, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\bPS[345]\b|\bPS Vita\b/gi, '');
  return { name: normalizeTitle(name), platform, year: year ? Number(year[1]) : null };
}

export function evaluateCandidate(r: SearxResult, gameTitle: string, platform: PsPlatform, gameYear: number | null = null): TrophyCandidate {
  let host = '';
  let pathname = '';
  try {
    const u = new URL(r.url);
    host = u.protocol === 'https:' ? u.hostname.replace(/^www\./, '') : '';
    pathname = u.pathname;
  } catch {
    /* ignored below */
  }
  // Exact domain only: subdomains such as forum.psnprofiles.com are discussion threads, not guides.
  const site = GUIDE_SITES.find((s) => host === s.domain);
  const { name, platform: hint, year } = guideGameName(r.title);
  const parsed = parseGuideText(`${r.title} ${r.content}`);
  const c: TrophyCandidate = {
    url: r.url.slice(0, 500),
    site: site?.name ?? host,
    title: r.title.slice(0, 200),
    excerpt: r.content.slice(0, 280),
    platform_hint: hint,
    parsed,
    matched: false,
    accepted: false,
    reason: '',
  };
  if (!site) c.reason = 'Not a recognised trophy-guide site';
  else if (!GUIDE_PATH[site.domain].test(pathname) || !/trophy|trophies|platinum|roadmap/i.test(r.title)) c.reason = 'Not a trophy guide page';
  else if (name !== normalizeTitle(gameTitle)) c.reason = `Different game (“${name}”)`;
  else if (year && gameYear && year !== gameYear) c.reason = `Guide is for the ${year} release, this is ${gameYear}`;
  else if (hint && hint !== platform) c.reason = `Guide is for ${hint}, you are playing on ${platform}`;
  else if (parsed.hours_max == null && parsed.difficulty_max == null) {
    c.matched = true;
    c.reason = 'Guide found but its summary has no hours or difficulty';
  } else {
    c.matched = true;
    c.accepted = true;
    c.reason = 'Title, site and platform match';
  }
  return c;
}

// ---------------- jobs ----------------

const mapJob = (r: any): TrophyJob => ({
  id: r.id,
  platform: r.platform,
  trigger: r.trigger,
  status: r.status,
  query: r.query,
  candidates: JSON.parse(r.candidates),
  proposal: r.proposal ? JSON.parse(r.proposal) : null,
  previous: r.previous ? JSON.parse(r.previous) : null,
  error: r.error ?? null,
  applied_at: r.applied_at ?? null,
  reverted_at: r.reverted_at ?? null,
  created_at: r.created_at,
});

export const latestJob = (db: DB, entryId: string): TrophyJob | null => {
  const r = get<any>(db, 'SELECT * FROM trophy_lookup_jobs WHERE entry_id = :e ORDER BY created_at DESC, rowid DESC LIMIT 1', { e: entryId });
  return r ? mapJob(r) : null;
};

const STACK_COLS = ['platinum', 'hours_min', 'hours_max', 'difficulty_min', 'difficulty_max', 'difficulty_text', 'playthroughs', 'online_required', 'missables', 'guide_url', 'source', 'checked_at', 'notes', 'user_locked'] as const;

function stackRow(db: DB, mediaId: string, platform: PsPlatform) {
  return get<any>(db, `SELECT * FROM trophy_guides WHERE media_id = :m AND platform = :p AND region = 'ALL'`, { m: mediaId, p: platform });
}

/** Writes the proposal into the play-platform stack, keeping a snapshot of what was there for revert. */
function applyProposal(db: DB, jobId: string) {
  tx(db, () => {
    const job = get<any>(db, 'SELECT j.*, le.media_id FROM trophy_lookup_jobs j JOIN library_entries le ON le.id = j.entry_id WHERE j.id = :id', { id: jobId });
    if (!job?.proposal) throw new AppError('CONFLICT', 'Nothing to apply');
    const prop = JSON.parse(job.proposal) as TrophyProposal & { source: string; guide_url: string };
    const existing = stackRow(db, job.media_id, job.platform);
    const previous = existing ? Object.fromEntries(STACK_COLS.map((c) => [c, existing[c] ?? null])) : null;
    const vals = {
      platinum: prop.mentions_platinum ? 'YES' : (existing?.platinum ?? 'UNKNOWN'),
      hours_min: prop.hours_min ?? existing?.hours_min ?? null,
      hours_max: prop.hours_max ?? existing?.hours_max ?? null,
      difficulty_min: prop.difficulty_min ?? existing?.difficulty_min ?? null,
      difficulty_max: prop.difficulty_max ?? existing?.difficulty_max ?? null,
      difficulty_text: prop.difficulty_text ?? existing?.difficulty_text ?? null,
      playthroughs: prop.playthroughs ?? existing?.playthroughs ?? null,
      online_required: prop.online_required ?? existing?.online_required ?? null,
      missables: prop.missables ?? existing?.missables ?? null,
      guide_url: prop.guide_url,
      source: prop.source ?? "Guide",
      checked_at: nowIso(),
      notes: existing?.notes ?? '',
      user_locked: 0,
    };
    if (existing) {
      run(db, `UPDATE trophy_guides SET ${STACK_COLS.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`, { ...vals, id: existing.id });
    } else {
      run(
        db,
        `INSERT INTO trophy_guides (id, media_id, platform, region, ${STACK_COLS.join(', ')})
         VALUES (:id, :m, :p, 'ALL', ${STACK_COLS.map((c) => `:${c}`).join(', ')})`,
        { ...vals, id: uuid(), m: job.media_id, p: job.platform },
      );
    }
    run(db, 'UPDATE trophy_lookup_jobs SET applied_at = :now, previous = :prev WHERE id = :id', { now: nowIso(), prev: JSON.stringify(previous), id: jobId });
  });
}

export function applyJob(db: DB, jobId: string) {
  const job = get<any>(db, 'SELECT * FROM trophy_lookup_jobs WHERE id = :id', { id: jobId });
  if (!job) throw new AppError('NOT_FOUND', 'Lookup not found');
  if (job.applied_at && !job.reverted_at) throw new AppError('CONFLICT', 'Already applied');
  if (!['FOUND', 'PARTIAL', 'NEEDS_REVIEW'].includes(job.status)) throw new AppError('CONFLICT', 'This lookup found nothing to apply');
  if (job.reverted_at) run(db, 'UPDATE trophy_lookup_jobs SET reverted_at = NULL WHERE id = :id', { id: jobId });
  applyProposal(db, jobId);
  return job.entry_id as string;
}

/** Restores the stack exactly as it was before this lookup was applied. */
export function revertJob(db: DB, jobId: string) {
  return tx(db, () => {
    const job = get<any>(db, 'SELECT j.*, le.media_id FROM trophy_lookup_jobs j JOIN library_entries le ON le.id = j.entry_id WHERE j.id = :id', { id: jobId });
    if (!job) throw new AppError('NOT_FOUND', 'Lookup not found');
    if (!job.applied_at || job.reverted_at) throw new AppError('CONFLICT', 'Nothing to revert');
    const later = get(db, 'SELECT 1 FROM trophy_lookup_jobs WHERE entry_id = :e AND applied_at > :t AND reverted_at IS NULL', { e: job.entry_id, t: job.applied_at });
    if (later) throw new AppError('CONFLICT', 'A newer lookup was applied after this one');
    const existing = stackRow(db, job.media_id, job.platform);
    const prev = job.previous ? JSON.parse(job.previous) : null;
    if (!prev) {
      if (existing) run(db, 'DELETE FROM trophy_guides WHERE id = :id', { id: existing.id });
    } else if (existing) {
      run(db, `UPDATE trophy_guides SET ${STACK_COLS.map((c) => `${c} = :${c}`).join(', ')} WHERE id = :id`, { ...prev, id: existing.id });
    }
    run(db, 'UPDATE trophy_lookup_jobs SET reverted_at = :now WHERE id = :id', { now: nowIso(), id: jobId });
    return job.entry_id as string;
  });
}

export function startJob(db: DB, entryId: string, platform: PsPlatform, trigger: TrophyJob['trigger']): string {
  const id = uuid();
  run(db, `INSERT INTO trophy_lookup_jobs (id, entry_id, platform, trigger, status, created_at) VALUES (:id, :e, :p, :t, 'RUNNING', :now)`, {
    id,
    e: entryId,
    p: platform,
    t: trigger,
    now: nowIso(),
  });
  return id;
}

/**
 * Runs a lookup for an existing RUNNING job. ADD / PLATFORM_CHANGE auto-apply unless the stack holds manual
 * (user_locked) values; REFRESH never auto-applies — the user reviews the diff first (FR-05).
 */
export async function runJob(db: DB, jobId: string): Promise<void> {
  const job = get<any>(
    db,
    `SELECT j.*, le.media_id, m.title, m.year FROM trophy_lookup_jobs j JOIN library_entries le ON le.id = j.entry_id
     JOIN media_items m ON m.id = le.media_id WHERE j.id = :id`,
    { id: jobId },
  );
  if (!job) return;
  // Probe (2026-10-25, 10 games): this wording surfaced parseable guide summaries far more often than "<title> <platform> trophy guide roadmap";
  // the site-targeted query adds PowerPyx roadmaps the general query misses.
  const queries = [`${job.title} trophy guide difficulty hours to platinum`, `site:powerpyx.com ${job.title} trophy guide`];
  const query = queries.join(' | ');
  const finish = (fields: Record<string, unknown>) =>
    run(
      db,
      `UPDATE trophy_lookup_jobs SET status = :status, query = :query, candidates = :candidates, proposal = :proposal, error = :error, finished_at = :now WHERE id = :id`,
      { candidates: '[]', proposal: null, error: null, ...fields, query, now: nowIso(), id: jobId },
    );
  const results: SearxResult[] = [];
  try {
    for (const q of queries) {
      for (const r of await searx(q)) if (!results.some((x) => x.url === r.url)) results.push(r);
    }
  } catch (err) {
    if (!results.length) {
      finish({ status: 'ERROR', error: err instanceof AppError ? err.message : 'Search failed' });
      return;
    }
  }
  const candidates = results.map((r) => evaluateCandidate(r, job.title, job.platform, job.year ?? null)).filter((c) => GUIDE_SITES.some((s) => s.name === c.site));
  const rank = (c: TrophyCandidate) => GUIDE_SITES.findIndex((s) => s.name === c.site);
  const fields = (c: TrophyCandidate) => (c.parsed.hours_max != null ? 1 : 0) + (c.parsed.difficulty_max != null ? 1 : 0);
  // Search summaries are often truncated. If none gave both hours and difficulty, read the roadmap box of up to two
  // matched guide pages (owner decision 2026-10-25), best-ranked site first.
  if (!candidates.some((c) => c.accepted && fields(c) === 2)) {
    // Search often misses PowerPyx (the one site without a bot wall), but its guide URLs follow a fixed pattern.
    // The guessed page is only used if its own heading names this game and it was published after the game's release.
    if (!candidates.some((c) => c.site === 'PowerPyx' && c.matched)) candidates.push(powerPyxGuess(job.title, job.platform));
    const toRead = candidates.filter((c) => c.matched).sort((a, b) => rank(a) - rank(b)).slice(0, 2);
    for (const c of toRead) {
      await readPage(c, job.title, job.year ?? null);
      if (c.accepted && fields(c) === 2) break;
    }
  }
  const accepted = candidates.filter((c) => c.accepted).sort((a, b) => fields(b) - fields(a) || Number(!!b.from_page) - Number(!!a.from_page) || rank(a) - rank(b));
  // One guide is used as-is; values from different guides are never averaged or mixed.
  const best = accepted[0];
  const shown = [...accepted, ...candidates.filter((c) => !c.accepted)].slice(0, 6);
  if (!best) {
    finish({ status: 'NOT_FOUND', candidates: JSON.stringify(shown) });
    return;
  }
  const hasBoth = best.parsed.hours_max != null && best.parsed.difficulty_max != null;
  const existing = stackRow(db, job.media_id, job.platform);
  const manual = !!existing?.user_locked;
  const status = job.trigger === 'REFRESH' || manual ? 'NEEDS_REVIEW' : hasBoth ? 'FOUND' : 'PARTIAL';
  finish({ status, candidates: JSON.stringify(shown), proposal: JSON.stringify({ ...best.parsed, source: `${best.site} (${best.from_page ? "guide roadmap" : "search summary"})`, guide_url: best.url }) });
  if (status !== 'NEEDS_REVIEW') applyProposal(db, jobId);
}

const EMPTY_PARSE: TrophyProposal = {
  hours_min: null,
  hours_max: null,
  difficulty_min: null,
  difficulty_max: null,
  difficulty_text: null,
  playthroughs: null,
  online_required: null,
  missables: null,
  mentions_platinum: false,
};

export function powerPyxGuess(title: string, platform: PsPlatform): TrophyCandidate {
  const slug = normalizeTitle(title).replace(/ /g, '-');
  return {
    url: `https://www.powerpyx.com/${slug}-trophy-guide-roadmap/`,
    site: 'PowerPyx',
    title: `${title} Trophy Guide & Roadmap (PowerPyx)`,
    excerpt: '',
    platform_hint: null,
    parsed: { ...EMPTY_PARSE },
    matched: true,
    accepted: false,
    reason: `Tried PowerPyx’s usual guide address for ${platform}`,
  };
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

/**
 * Reads one guide page and, if its roadmap box has values, replaces the candidate's snippet values with them.
 * Identity checks on the page itself: its heading must name this game, and it must not predate the game's release.
 */
async function readPage(c: TrophyCandidate, gameTitle: string, gameYear: number | null): Promise<void> {
  try {
    const html = await fetchGuidePage(c.url);
    const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
    const headingText = htmlToText(heading);
    if (guideGameName(headingText).name !== normalizeTitle(gameTitle)) {
      c.reason = `Guide page is for a different game (“${headingText.slice(0, 80)}”)`;
      return;
    }
    const text = htmlToText(html);
    const published = new RegExp(`(?:${MONTHS})\\s+\\d{1,2},\\s+(\\d{4})`).exec(text.slice(0, Math.max(0, text.search(/estimated\s+trophy\s+difficulty/i)) || 3000));
    if (gameYear && published && Number(published[1]) < gameYear) {
      c.reason = `Guide was written in ${published[1]}, before this ${gameYear} release — likely an older version`;
      return;
    }
    const box = roadmapBox(text);
    if (!box) {
      c.reason = 'Guide page has no roadmap box Blackhole can read';
      return;
    }
    const parsed = parseGuideText(box);
    if (parsed.hours_max == null && parsed.difficulty_max == null) {
      c.reason = 'Guide page read, but its roadmap box has no hours or difficulty';
      return;
    }
    c.parsed = { ...parsed, mentions_platinum: parsed.mentions_platinum || c.parsed.mentions_platinum };
    c.excerpt = box.slice(0, 400);
    c.from_page = true;
    c.accepted = true;
    c.reason = 'Read from the guide page’s roadmap';
  } catch (err) {
    c.reason = err instanceof AppError ? err.message : 'Guide page could not be read';
  }
}

export function jobsForEntry(db: DB, entryId: string) {
  return all<any>(db, 'SELECT * FROM trophy_lookup_jobs WHERE entry_id = :e ORDER BY created_at DESC LIMIT 10', { e: entryId }).map(mapJob);
}
