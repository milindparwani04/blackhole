import { describe, expect, it } from 'vitest';
import { matchCommands, parseSearch } from '../../apps/web/src/searchCommand.js';

describe('top-bar search commands', () => {
  it('a command picks the media type and leaves the title as the search text', () => {
    expect(parseSearch('/book red rising')).toEqual({ type: 'BOOK', text: 'red rising', partial: null });
    expect(parseSearch('/game  hollow knight ')).toEqual({ type: 'GAME', text: 'hollow knight', partial: null });
    expect(parseSearch('/tv fargo')).toEqual({ type: 'TV', text: 'fargo', partial: null });
    expect(parseSearch('/MOVIE dune')).toEqual({ type: 'MOVIE', text: 'dune', partial: null });
  });

  it('aliases work', () => {
    expect(parseSearch('/books red rising').type).toBe('BOOK');
    expect(parseSearch('/film dune').type).toBe('MOVIE');
    expect(parseSearch('/show fargo').type).toBe('TV');
    expect(parseSearch('/games doom').type).toBe('GAME');
  });

  it('a bare command has a type but no text yet', () => {
    expect(parseSearch('/book')).toEqual({ type: 'BOOK', text: '', partial: null });
  });

  it('a half-typed command is partial and suggests matches', () => {
    expect(parseSearch('/bo')).toEqual({ type: null, text: '', partial: 'bo' });
    expect(parseSearch('/')).toEqual({ type: null, text: '', partial: '' });
    expect(matchCommands('bo').map((c) => c.cmd)).toEqual(['book']);
    expect(matchCommands('').map((c) => c.cmd)).toEqual(['game', 'movie', 'tv', 'book']);
    expect(matchCommands('s').map((c) => c.cmd)).toEqual(['tv']);
  });

  it('no command means a plain library search with no provider type (never defaults to games)', () => {
    expect(parseSearch('red rising')).toEqual({ type: null, text: 'red rising', partial: null });
    expect(parseSearch('/xyz red rising')).toEqual({ type: null, text: 'red rising', partial: null });
  });
});
