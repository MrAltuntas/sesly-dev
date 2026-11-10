/**
 * QueueSheetHost: the one queue sheet of the app (SPEC-audio 6.5), mounted
 * by RootHosts inside the navigation container and shown by the `queueSheet`
 * controller (`queueSheet.open('player' | 'library' | 'toast')`).
 *
 * The sheet is created at the first open, so a launch pays nothing for it,
 * and stays mounted after that so it can animate out. Navigation goes
 * through the container ref: the host lives outside every screen.
 */

import React, { useRef } from 'react';
import { CommonActions } from '@react-navigation/native';
import { observer } from 'mobx-react-lite';
import { navigationRef } from '../../navigation/navigationRef';
import { queueSheet } from '../../stores/queueSheet';
import { requestLibrarySegment } from '../library/librarySegment';
import { QueueSheet } from './QueueSheet';

/**
 * The player on this narration, with autoplay (the start is already
 * running, so the screen renders at once and starts nothing twice). A player
 * already in the stack is popped back to instead of stacking a second one.
 */
export function openQueuedPlayer(narrationId: string): void {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(
    CommonActions.navigate('AudioPlayer', { narrationId, autoplay: true }, { pop: true }),
  );
}

/** Masallarım in the Kütüphane tab, back on the tab shell. */
export function openQueueLibrary(): void {
  requestLibrarySegment('mine');
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(CommonActions.navigate('Main', { screen: 'Library' }, { pop: true }));
}

export const QueueSheetHost: React.FC = observer(() => {
  const opened = useRef(false);
  if (queueSheet.visible) opened.current = true;
  if (!opened.current) return null;
  return (
    <QueueSheet
      visible={queueSheet.visible}
      origin={queueSheet.origin}
      onClose={queueSheet.close}
      onOpenPlayer={openQueuedPlayer}
      onOpenLibrary={openQueueLibrary}
    />
  );
});

export default QueueSheetHost;
