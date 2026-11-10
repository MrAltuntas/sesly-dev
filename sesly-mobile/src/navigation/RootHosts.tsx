/**
 * Hosts that live once for the whole app, inside NavigationContainer and
 * outside every screen. RootNavigator renders them with the boot route, so
 * they exist before anything can play.
 *
 *   - AudioSessionBridge: the audio mode per plan, the one AppState listener,
 *     the queue's story end handler, the sleep timer's player and the
 *     sign-out cleanup of the player, the timer and the queue.
 *   - QueueSheetHost: the "Sıradakiler" sheet, opened from anywhere through
 *     `queueSheet.open(origin)`; created at its first open.
 */

import React from 'react';
import { AudioSessionBridge } from '../components/audio/AudioSessionBridge';
import { QueueSheetHost } from '../components/audio/QueueSheetHost';

export const RootHosts: React.FC = () => (
  <>
    <AudioSessionBridge />
    <QueueSheetHost />
  </>
);

export default RootHosts;
