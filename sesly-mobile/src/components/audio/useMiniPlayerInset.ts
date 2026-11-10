/**
 * useMiniPlayerInset: the room a tab screen leaves at the end of its list for
 * the mini player (SPEC-design's `useBottomChromeInset`).
 *
 * The mini player floats over the tab scene (MainScaffold's overlay), so the
 * scene never changes height when it shows or hides. A tab list adds this to
 * its `contentContainerStyle.paddingBottom` (after `T.tabBarReservedHeight`)
 * so its last row can still scroll clear of the card:
 *
 *   const inset = useMiniPlayerInset();
 *   contentContainerStyle={{ paddingBottom: T.tabBarReservedHeight + inset }}
 *
 * `MINI_PLAYER_DOCK_HEIGHT + T.space.sm` while the store shows the mini
 * player (`audio.showMiniPlayer`), else 0. The padding only matters at the
 * end of the list, so it follows the store at once (no motion).
 *
 * It follows the store through a reaction, so it works in a screen that is
 * not an observer, and a screen does not re-render for any other store field.
 */

import { useEffect, useState } from 'react';
import { reaction } from 'mobx';
import { useT } from '../../theme/theme';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { MINI_PLAYER_DOCK_HEIGHT } from '../design/MiniPlayerBar';

export function useMiniPlayerInset(): number {
  const T = useT();
  const audio = useAudioPlayer();
  const [shown, setShown] = useState(() => !!audio.showMiniPlayer);
  useEffect(
    // fireImmediately: a change between the first render and this effect is not lost.
    () => reaction(() => !!audio.showMiniPlayer, setShown, { fireImmediately: true }),
    [audio],
  );
  return shown ? MINI_PLAYER_DOCK_HEIGHT + T.space.sm : 0;
}

export default useMiniPlayerInset;
