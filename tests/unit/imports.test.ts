import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../apps/api/src/db/db.js';
import { buildServer } from '../../apps/api/src/server.js';
import { resetGuidePageStateForTests } from '../../apps/api/src/adapters/guidepage.js';
import { letterboxdUser, parseFilmGrid } from '../../apps/api/src/adapters/letterboxd.js';
import { parseCsv, parseGoodreadsCsv, stripSeries } from '../../apps/api/src/adapters/goodreads.js';
import { pickBook, pickMatch, resetImportsForTests } from '../../apps/api/src/services/imports.js';

const PORT = 4317;
const headers = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-blackhole': '1' };

const tile = (name: string, slug: string, rated?: number) =>
  `<li class="griditem"><div class="react-component" data-item-name="${name}" data-item-slug="${slug}" data-target-link="/film/${slug}/"></div>` +
  (rated ? `<p class="poster-viewingdata"><span class="rating -micro -darker rated-${rated}">★★★</span></p>` : '') +
  `</li>`;
const grid = (tiles: string[], pages: number[] = []) =>
  `<ul class="grid">${tiles.join('')}</ul><div class="paginate-pages"><ul>${pages.map((p) => `<li><a href="/milindparwani/films/page/${p}/">${p}</a></li>`).join('')}</ul></div>`;
/** Minimal ZIP writer (deflate entries, CRC left at 0 — the reader doesn't check it). */
function zipOf(entries: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = zlib.deflateRawSync(Buffer.from(text));
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(n.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(text.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(dir, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const tmdbHit = (id: number, title: string, date: string) => ({ id, title, release_date: date, overview: '', poster_path: null, genre_ids: [18] });

describe('Letterboxd parsing', () => {
  it('accepts a profile link or a username, and rejects other sites', () => {
    expect(letterboxdUser('https://letterboxd.com/MilindParwani/')).toBe('MilindParwani');
    expect(letterboxdUser('letterboxd.com/MilindParwani/films/page/2/')).toBe('MilindParwani');
    expect(letterboxdUser('MilindParwani')).toBe('MilindParwani');
    expect(() => letterboxdUser('https://evil.example/letterboxd.com/x')).toThrow();
    expect(() => letterboxdUser('https://letterboxd.com/film/heat/')).toThrow();
  });

  it('reads title, year, half-star rating and the last page', () => {
    const g = parseFilmGrid(grid([tile('Heat (1995)', 'heat', 9), tile('Amélie &amp; Co (2001)', 'amelie', undefined), tile('Untitled', 'untitled')], [2, 3]));
    expect(g.films).toEqual([
      { slug: 'heat', title: 'Heat', year: 1995, rating: 9 },
      { slug: 'amelie', title: 'Amélie & Co', year: 2001, rating: null },
      { slug: 'untitled', title: 'Untitled', year: null, rating: null },
    ]);
    expect(g.lastPage).toBe(3);
  });

  it('matches TMDb results by title and year (±1), never across distant years', () => {
    const r = (title: string, year: number) => ({ provider: 'TMDB', external_id: String(year), type: 'MOVIE' as const, title, year }) as any;
    expect(pickMatch({ title: 'Dune', year: 2021 }, [r('Dune', 1984), r('Dune', 2021)])?.year).toBe(2021);
    expect(pickMatch({ title: 'Dune', year: 2022 }, [r('Dune', 2021)])?.year).toBe(2021);
    expect(pickMatch({ title: 'Dune', year: 2010 }, [r('Dune', 1984), r('Dune', 2021)])).toBeNull();
  });
});

describe('Letterboxd import', () => {
  let app: ReturnType<typeof buildServer>;
  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers, payload });
    return { status: res.statusCode, body: res.json() as any };
  };
  const finish = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const j = (await call('GET', `/api/import/jobs/${id}`)).body;
      if (j.finished) return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job never finished');
  };

  beforeEach(() => {
    app = buildServer({ db: openDb(':memory:'), host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
    process.env.TMDB_API_TOKEN = 'eyJ-long-v4-read-token';
    process.env.IMPORT_GAP_MS = '0';
    resetGuidePageStateForTests();
    resetImportsForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const u = new URL(String(url));
        if (u.hostname === 'letterboxd.com') {
          if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /*/by/*\n');
          if (u.pathname === '/MilindParwani/films/') return new Response(grid([tile('Heat (1995)', 'heat', 9), tile('Ronin (1998)', 'ronin', 7)], [2]));
          // Letterboxd puts films pages 2+ behind a bot check; Blackhole must never request them.
          if (u.pathname === '/MilindParwani/films/page/2/') throw new Error('films page 2 must not be requested');
          if (u.pathname === '/MilindParwani/watchlist/') return new Response(grid([tile('Heat (1995)', 'heat'), tile('Dune (2021)', 'dune-2021')], [2]));
          if (u.pathname === '/MilindParwani/watchlist/page/2/') return new Response(grid([tile('Obscure Short (2019)', 'obscure-short')]));
          return new Response('nope', { status: 404 });
        }
        if (u.hostname === 'api.themoviedb.org') {
          const q = u.searchParams.get('query');
          if (u.pathname === '/3/search/movie')
            return new Response(
              JSON.stringify({
                results:
                  q === 'Heat'
                    ? [tmdbHit(949, 'Heat', '1995-12-15')]
                    : q === 'Ronin'
                      ? [tmdbHit(8195, 'Ronin', '1998-09-25')]
                      : q === 'Dune'
                        ? [tmdbHit(438631, 'Dune', '2021-09-15')]
                        : [],
              }),
            );
          return new Response(
            JSON.stringify({
              id: 1,
              title: 'x',
              runtime: 120,
              imdb_id: null,
              genres: [{ id: 18, name: 'Drama' }],
              credits: { crew: [{ job: 'Director', name: 'Someone' }] },
            }),
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TMDB_API_TOKEN;
    delete process.env.IMPORT_GAP_MS;
  });

  it('previews without writing, then imports watched as Completed with rating and watchlist as Planned', async () => {
    // Ronin is already in the Pit as a manual entry: it must be flagged and left alone.
    await call('POST', '/api/library', { type: 'MOVIE', title: 'Ronin', year: 1998 });

    const started = await call('POST', '/api/import/letterboxd/preview', { profile: 'https://letterboxd.com/MilindParwani/' });
    expect(started.status).toBe(202);
    const preview = await finish(started.body.id);
    expect(preview.error).toBeNull();
    expect(preview.notice).toMatch(/page 1 of 2/);
    const byKey = Object.fromEntries(preview.items.map((i: any) => [i.key, i]));
    expect(Object.keys(byKey).sort()).toEqual(['dune-2021', 'heat', 'obscure-short', 'ronin']);
    expect(byKey.heat).toMatchObject({ status: 'COMPLETED', rating: 9, match: { provider: 'TMDB', external_id: '949' }, in_pit: null });
    expect(byKey['dune-2021']).toMatchObject({ status: 'PLANNED', rating: null, match: { external_id: '438631' } });
    expect(byKey['obscure-short'].match).toBeNull();
    expect(byKey.ronin.in_pit).toBeTruthy();
    expect((await call('GET', '/api/library?type=MOVIE')).body).toHaveLength(1);

    const imported = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(imported.result).toEqual({ added: 3, skipped: 1, failed: [] });
    const rows = (await call('GET', '/api/library?type=MOVIE')).body as any[];
    const get = (t: string) => rows.find((r) => r.media.title === t);
    expect(get('Heat').entry).toMatchObject({ status: 'COMPLETED', personal_rating: 9, completed_at: null });
    expect(get('Heat').media).toMatchObject({ runtime_min: 120, creator: 'Someone' });
    expect(get('Dune').entry).toMatchObject({ status: 'PLANNED', personal_rating: null });
    expect(get('Obscure Short').entry).toMatchObject({ status: 'PLANNED', personal_rating: null });
    expect(get('Obscure Short').media.source_url).toBe('https://letterboxd.com/film/obscure-short/');
    expect(get('Ronin').entry.status).toBe('PLANNED');

    // Running it again adds nothing.
    const again = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(again.result).toEqual({ added: 0, skipped: 4, failed: [] });
  });

  it('imports the Letterboxd export (ZIP or loose CSVs) with half-star ratings and diary dates', async () => {
    const files: Record<string, string> = {
      'watched.csv': 'Date,Name,Year,Letterboxd URI\n2026-01-01,Heat,1995,https://boxd.it/abc\n2026-01-02,"Obscure, Short",2019,https://boxd.it/def\n',
      'ratings.csv': 'Date,Name,Year,Letterboxd URI,Rating\n2026-01-01,Heat,1995,https://boxd.it/abc,4.5\n',
      'diary.csv':
        'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2026-01-01,Heat,1995,https://boxd.it/x1,4.5,,,2024-03-02\n2026-01-03,Heat,1995,https://boxd.it/x2,4.5,Yes,,2025-07-09\n',
      'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2026-01-01,Dune,2021,https://boxd.it/ghi\n2026-01-01,Heat,1995,https://boxd.it/abc\n',
    };
    const zip = zipOf({
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`letterboxd-me/${k}`, v])),
      'letterboxd-me/deleted/watched.csv': 'Date,Name,Year,Letterboxd URI\n2026-01-01,Gone,2000,https://boxd.it/zzz\n',
    });
    const viaZip = await finish((await call('POST', '/api/import/letterboxd/export', { zip: zip.toString('base64') })).body.id);
    const viaCsv = await finish((await call('POST', '/api/import/letterboxd/export', { files })).body.id);
    for (const p of [viaZip, viaCsv]) {
      expect(p.error).toBeNull();
      expect(p.notice).toBeNull();
      expect(p.items.map((i: any) => i.title)).toEqual(['Heat', 'Obscure, Short', 'Dune']);
      expect(p.items[0]).toMatchObject({
        status: 'COMPLETED',
        rating: 9,
        completed_at: '2025-07-09T12:00:00.000Z',
        source_url: 'https://boxd.it/abc',
        match: { external_id: '949' },
      });
      expect(p.items[1]).toMatchObject({ status: 'COMPLETED', rating: null, completed_at: null, match: null });
      expect(p.items[2]).toMatchObject({ status: 'PLANNED', match: { external_id: '438631' } });
    }
    const done = await finish((await call('POST', '/api/import', { items: viaZip.items })).body.id);
    expect(done.result).toEqual({ added: 3, skipped: 0, failed: [] });
    const heat = ((await call('GET', '/api/library?type=MOVIE')).body as any[]).find((r) => r.media.title === 'Heat');
    expect(heat.entry).toMatchObject({ status: 'COMPLETED', personal_rating: 9, completed_at: '2025-07-09T12:00:00.000Z' });
    expect((await call('POST', '/api/import/letterboxd/export', { files: { 'notes.csv': 'a,b\n1,2' } })).status).toBe(400);
  });

  it('reports an unknown profile clearly', async () => {
    const j = await finish((await call('POST', '/api/import/letterboxd/preview', { profile: 'nobody_here' })).body.id);
    expect(j.error).toMatch(/no profile called/);
  });

  it('rejects non-Letterboxd links and items pointing elsewhere', async () => {
    expect((await call('POST', '/api/import/letterboxd/preview', { profile: 'https://example.com/me' })).status).toBe(400);
    const ok = {
      key: 'x',
      source: 'LETTERBOXD',
      type: 'MOVIE',
      title: 'X',
      year: 2000,
      creator: null,
      rating: null,
      status: 'COMPLETED',
      completed_at: null,
      pages: null,
      isbn: null,
      source_url: 'https://letterboxd.com/film/x/',
      match: null,
      in_pit: null,
    };
    expect((await call('POST', '/api/import', { items: [{ ...ok, source_url: 'https://evil.example/film/x/' }] })).status).toBe(400);
    expect(
      (
        await call('POST', '/api/import', {
          items: [
            {
              ...ok,
              match: { provider: 'TMDB', external_id: '1', title: 'X', year: 2000, cover_url: 'https://evil.example/a.jpg', synopsis: null, genres: [] },
            },
          ],
        })
      ).status,
    ).toBe(400);
    expect((await call('POST', '/api/import', { items: [{ ...ok, type: 'BOOK' }] })).status).toBe(400);
  });
});

const CSV = [
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies',
  '68428,"Mistborn: The Final Empire (Mistborn, #1)",Brandon Sanderson,"Sanderson, Brandon",,"=""""","=""9780765311788""",4,Tor Books,Hardcover,541,2006,2006,2026/05/27,2026/03/21,,,read,,,,1,0',
  '15839976,"Red Rising (Red Rising Saga, #1)",Pierce Brown,"Brown, Pierce",,"=""""","=""""",0,Del Rey,Hardcover,382,2014,2014,,2026/03/21,,,currently-reading,,,,1,0',
  '1,"A ""Quoted"", Title",Some One,"One, Some",,"=""""","=""""",0,X,,,,1890,,2026/03/21,did-not-finish,did-not-finish (#1),did-not-finish,"line one',
  'line two",,,0,0',
  '2,Obscure Pamphlet,Nobody Known,"Known, Nobody",,"=""""","=""""",0,X,,12,,,,2026/03/21,to-read,to-read (#2),to-read,,,,0,0',
].join('\r\n');

describe('Goodreads import', () => {
  let app: ReturnType<typeof buildServer>;
  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers, payload });
    return { status: res.statusCode, body: res.json() as any };
  };
  const finish = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const j = (await call('GET', `/api/import/jobs/${id}`)).body;
      if (j.finished) return j;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job never finished');
  };
  const olDoc = (key: string, title: string, author: string, year: number) => ({
    key,
    title,
    author_name: [author],
    first_publish_year: year,
    cover_i: 1,
    number_of_pages_median: 999,
  });

  beforeEach(() => {
    app = buildServer({ db: openDb(':memory:'), host: '127.0.0.1', port: PORT, dataDir: 'data-test' });
    process.env.IMPORT_GAP_MS = '0';
    resetImportsForTests();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const q = new URL(String(url)).searchParams.get('q');
        const docs =
          q === 'isbn:9780765311788'
            ? [olDoc('/works/OL5738148W', 'The Final Empire', 'Brandon Sanderson', 2001)]
            : q === 'Red Rising Pierce Brown'
              ? [olDoc('/works/OL99W', 'Red Rising Graphic Novel', 'Someone Else', 2020), olDoc('/works/OL17076473W', 'Red Rising', 'Pierce Brown', 2014)]
              : [];
        return new Response(JSON.stringify({ docs }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.IMPORT_GAP_MS;
  });

  it('parses the export: quoted fields, ISBN wrappers, shelves, stars and dates', () => {
    expect(parseCsv('a,"b ""c"", d"\r\n1,2')).toEqual([
      ['a', 'b "c", d'],
      ['1', '2'],
    ]);
    expect(stripSeries('Mistborn: The Final Empire (Mistborn, #1)')).toBe('Mistborn: The Final Empire');
    expect(stripSeries('Shoe Dog (A Memoir)')).toBe('Shoe Dog (A Memoir)');
    const [mistborn, red, quoted, obscure] = parseGoodreadsCsv(CSV);
    expect(mistborn).toMatchObject({ isbn: '9780765311788', rating: 8, pages: 541, year: 2006, status: 'COMPLETED', read_on: '2026-05-27' });
    expect(red).toMatchObject({ isbn: null, rating: null, status: 'IN_PROGRESS', read_on: null });
    expect(quoted).toMatchObject({ title: 'A "Quoted", Title', status: 'DROPPED', year: 1890 });
    expect(obscure).toMatchObject({ status: 'PLANNED', pages: 12 });
    expect(() => parseGoodreadsCsv('name,age\nbob,3')).toThrow(/Goodreads library export/);
  });

  it('only accepts an Open Library match by the same author', () => {
    const r = (title: string, creator: string) => ({ provider: 'OPENLIBRARY', external_id: '/works/OL1W', type: 'BOOK', title, creator }) as any;
    expect(pickBook({ title: 'Dune', author: 'Frank Herbert' }, [r('Dune', 'Someone Else'), r('Dune', 'Frank Herbert')])?.creator).toBe('Frank Herbert');
    expect(pickBook({ title: 'Dune', author: 'Frank Herbert' }, [r('Dune Messiah Companion', 'Ann Other')])).toBeNull();
  });

  it('previews and imports books with status, rating, pages and read date', async () => {
    const started = await call('POST', '/api/import/goodreads/preview', { csv: CSV });
    expect(started.status).toBe(202);
    const preview = await finish(started.body.id);
    expect(preview.error).toBeNull();
    const [mistborn, red, quoted, obscure] = preview.items;
    expect(mistborn).toMatchObject({
      title: 'Mistborn: The Final Empire',
      match: { external_id: '/works/OL5738148W' },
      completed_at: '2026-05-27T12:00:00.000Z',
    });
    expect(red.match.external_id).toBe('/works/OL17076473W');
    expect(quoted.match).toBeNull();
    expect(obscure.match).toBeNull();

    const done = await finish((await call('POST', '/api/import', { items: preview.items })).body.id);
    expect(done.result).toEqual({ added: 4, skipped: 0, failed: [] });
    const rows = (await call('GET', '/api/library?type=BOOK')).body as any[];
    const get = (t: string) => rows.find((r) => r.media.title === t);
    expect(get('Mistborn: The Final Empire').entry).toMatchObject({
      status: 'COMPLETED',
      personal_rating: 8,
      completed_at: '2026-05-27T12:00:00.000Z',
      current_page: 541,
    });
    // The export's own edition page count wins over Open Library's median.
    expect(get('Mistborn: The Final Empire').pages).toBe(541);
    expect(get('Red Rising').entry).toMatchObject({ status: 'IN_PROGRESS', personal_rating: null });
    expect(get('A "Quoted", Title').entry.status).toBe('DROPPED');
    expect(get('Obscure Pamphlet').media.source_url).toBe('https://www.goodreads.com/book/show/2');

    const again = await finish((await call('POST', '/api/import/goodreads/preview', { csv: CSV })).body.id);
    expect(again.items.every((i: any) => i.in_pit)).toBe(true);
  });

  it('rejects a CSV that is not a Goodreads export', async () => {
    expect((await call('POST', '/api/import/goodreads/preview', { csv: 'name,age\nbob,3' })).status).toBe(400);
  });
});
