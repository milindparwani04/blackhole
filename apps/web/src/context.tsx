import { createContext, useContext } from 'react';
import type { SearchKind } from '../../../packages/shared/src/index';

export interface AppCtx {
  /** Bumped after every mutation so lists/stats reload. */
  version: number;
  bump: () => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Opens the Add dialog on a tab (anime/manga search AniList); defaults to the current library's type. */
  openAdd: (kind?: SearchKind, query?: string) => void;
  notify: (message: string, opts?: { eventId?: string | null; error?: boolean }) => void;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
