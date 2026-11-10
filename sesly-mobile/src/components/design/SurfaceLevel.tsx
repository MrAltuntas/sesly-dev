/**
 * SurfaceLevel: which step of the neutral ladder a container is
 * (docs/release-pass/SPEC-design.md 1.6.1), so every neutral control inside
 * it draws one step up (raised) or one step down (inset) and never in the
 * container's own colour (`src/theme/surfaces.ts`).
 *
 *   <SurfaceLevelProvider level="surface">   // BottomSheet, Dialog card, Card
 *     <Button variant="secondary" ... />     // surface2 face
 *   </SurfaceLevelProvider>
 *
 * Providers only sit in containers (sheets, dialogs, cards, the mini player,
 * hand-made panels), never in `Tactile`, so long lists get no extra fibers.
 * Outside every provider the level is the canvas, `'bg'`.
 */

import React, { createContext, useContext } from 'react';
import type { SurfaceLevel } from '../../theme/surfaces';

export type { SurfaceLevel } from '../../theme/surfaces';

const SurfaceLevelContext = createContext<SurfaceLevel>('bg');
SurfaceLevelContext.displayName = 'SurfaceLevel';

export interface SurfaceLevelProviderProps {
  /** The level of the container these children are drawn on. */
  level: SurfaceLevel;
  children?: React.ReactNode;
}

export const SurfaceLevelProvider: React.FC<SurfaceLevelProviderProps> = ({ level, children }) => (
  <SurfaceLevelContext.Provider value={level}>{children}</SurfaceLevelContext.Provider>
);

/** Level of the nearest container; `'bg'` (the canvas) outside every provider. */
export function useSurfaceLevel(): SurfaceLevel {
  return useContext(SurfaceLevelContext);
}
