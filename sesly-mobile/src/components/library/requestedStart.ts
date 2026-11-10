/**
 * useRequestedStart: the play button of a Library row or of the continue
 * card answers at the touch (RC-6).
 *
 * A start of a story the player does not hold pauses the outgoing one,
 * re-renders the rows and the mini player and loads the stream; done in the
 * press, its work held the first commit back, so the button showed nothing
 * for over a second. `request(start)` marks the button as waiting in the
 * commit of the press (the caller draws its spinner from `requested`) and
 * runs `start` in the next frame, once that commit is on its way to the
 * screen. The mark goes when the start has settled; a caller also drops it
 * once the store shows the start itself (its pending or loaded narration).
 *
 * A second press while one waits starts nothing. An unmount does not cancel
 * the start: the user asked for it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface RequestedStart {
  /** A start was asked for and has not settled yet. */
  requested: boolean;
  /** Mark the button as waiting now, run `start` in the next frame. */
  request: (start: () => unknown) => void;
}

export function useRequestedStart(): RequestedStart {
  const [requested, setRequested] = useState(false);
  const frame = useRef<number | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const request = useCallback((start: () => unknown) => {
    if (frame.current !== null) return;
    setRequested(true);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const settle = () => {
        if (alive.current) setRequested(false);
      };
      Promise.resolve()
        .then(start)
        .then(settle, settle);
    });
  }, []);

  return { requested, request };
}
