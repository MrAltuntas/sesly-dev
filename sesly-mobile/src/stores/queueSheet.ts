/**
 * Who shows the queue sheet ("Sıradakiler"), app-wide. QueueSheetHost,
 * mounted once next to the navigator, observes it; the player's queue
 * button, the Library app bar and the "Sırayı aç" action of the add
 * snackbars open it. The origin decides what a tap on a row does: from the
 * player the sheet stays open and the player switches in place, from
 * anywhere else the sheet closes and the player opens.
 */

import { makeAutoObservable } from 'mobx';

export type QueueSheetOrigin = 'player' | 'library' | 'toast';

class QueueSheetController {
  visible = false;
  /** Where it was opened from; kept after close so the closing sheet still knows. */
  origin: QueueSheetOrigin = 'player';

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  open(origin: QueueSheetOrigin): void {
    this.origin = origin;
    this.visible = true;
  }

  close(): void {
    this.visible = false;
  }
}

export const queueSheet = new QueueSheetController();
export type { QueueSheetController };
