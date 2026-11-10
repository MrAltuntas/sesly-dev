# SPEC-audio: player, mini player, continue listening, queue, sleep timer

Release pass 2026-10-19. Owner items R11, R12, R13 (timer part), R14 (timer countdown,
sheet motion where the audio sheets need it), R1 / R10 (player spinner), R7 (audio tests),
R8 (player bugs). Worktree `sesly-mobile-rp`, branch `release-pass`.

Sources: code-audit.json dimensions player-library (r11-*, r12-*, new-1..3, other-1),
ui-player (audio-1..33), controls-motion (r13-timer-height, r13-segment-sink, r14-tile-flicker,
r14-wheel-*, other-bg-timer, r14-sheet-rerender, r14-tick-drift, r14-progress-frames, r14-dock,
r14-seek-knob, r14-bars, r14-stopline-flip), ux-journeys (ux-2, ux-5, ux-6, ux-9, ux-12,
ux-21, ux-26), perf-startup (perf-3, perf-4, perf-5, perf-10), coverage (test-5, test-6,
test-13, test-14, test-15, test-18, test-22, test-24), splash-loading r10-9, design-system
lip-2 / bug-1 / btn-4. Every claim below was re-checked against the worktree code and the
installed native sources (expo-audio 55.0.14, RN 0.83 timers) on 2026-10-19.

This is an implementer's guide. Decisions are final unless marked "owner".

---

## 0. Decisions at a glance

| # | Decision |
|---|----------|
| D1 | `AudioPlayerStore` gets an explicit state model: `source` ('none' / 'story' / 'sample'), `loadPhase`, `isPlaying` as the user's intent (not a copy of `status.playing`), `isBuffering`, `storyEnded`. Generation state lives in its own fields and never touches playback. |
| D2 | One load path: `startNarration(input, { autoplay, fromQueue })`. It pauses before every `replace`, flips state only after the steps that can throw, and can start a stream from cached metadata without a network round trip. |
| D3 | A story's end is handled inside the store, synchronously, by a handler installed once (`bindStoryEnd`). No screen consumes `didJustFinish` any more; the flag is removed from the public API. Samples are tracked by `sampleKey`. |
| D4 | Mini player: visible only while a story is loaded and playing (intent, so buffering counts), plus 5 s after a pause made from the mini player itself. Paused, finished, stopped, sample, restart: hidden. It overlays the tab scene (no scene resize) and animates in and out. |
| D5 | Library "Kaldığın yerden devam et" card at the top of Masallarım, from the `lastPlayed` record (now written by the store), with the saved position; its play button resumes in place. |
| D6 | The player opens instantly for a loaded story, and for any story whose metadata is known (row, card, queue, story detail). The full-screen loading line is left only for a narration nothing is known about (push tap). |
| D7 | Queue "Sıradakiler" is a device-local, per-account queue (`QueueStore`, AsyncStorage), not the backend playlist. The backend-backed `PlaylistStore`, `PlaylistSheet`, `PlaylistService` and `models/Playlist.ts` are removed from the app. No backend change. |
| D8 | Autoplay of the next story happens only when playback was started from the queue (explicit queue context). It runs in the store, so it works with the player closed and with the screen off. Track changes update the open player in place (`setParams`), never `replace`. |
| D9 | Sleep timer, Android: the duration deadline and its fade move into `modules/sesly-media` (`SeslySleepTimer`, main-looper Handler, wall clock). JS mirrors the state and keeps a status-driven fallback. iOS: JS timers keep running in the background (RCTTiming switches to an NSTimer), plus the same status-driven fallback. |
| D10 | Countdown without flicker: tabular figures, no auto-fit, value and unit split, one small observer per countdown, ticks aligned to the deadline; motion comes from a native-driven drain line, never from the digits. |
| D11 | Timer sheet body has one fixed height in every mode and state (3 visible wheel rows), so the header, the switch and the segmented control never move. While a duration runs the wheel stays and the chip row becomes the countdown row. |
| D12 | Progress bar: native timing in 20 s chunks, never animated while buffering or while the length is unknown; the backend's length estimate is never shown in the player. |
| D13 | Default timer mode for a user with no stored mode is "Süre dolunca" (20 dk). Every timer option is interactive while the timer is off and turns it on in its own mode. |
| D14 | Free plan background: the story pauses (as today) and no longer resumes by itself on return; one snackbar on return offers "Devam et". |

---

## 1. Root causes this spec fixes (verified)

| Bug | Where (worktree) | Cause |
|-----|------------------|-------|
| Starting a narration while another story is loaded overwrites it | `src/hooks/useAudioPlayer.ts` 563-566, 609, 632, 686-687; `src/services/WebSocketService.ts` 437; `src/screens/audio/AudioGenerationScreen.tsx` 162-166, 194-215, 235-244 | `generateAudio` / `trackExistingNarration` write `currentStory`, `currentVoiceProfile`, `audioId` of the playing story; `onStatusUpdate` then saves A's position and real length under B (450-452, 474-484); READY calls `loadFromNarration(B)` which takes over the speaker. |
| Buffering ignored | `useAudioPlayer.ts` 454, 920-924 | `isPlaying = !!status.playing`; `status.playing` is false while buffering on both platforms (Android `AudioPlayer.kt` `currentStatus`, iOS `timeControlStatus == .playing`). `togglePlayPause` decides from `player.playing`, so pause during a cold start calls `play()` again. |
| Estimated duration shown | `useAudioPlayer.ts` 791-815 | `totalDurationMs = resolveNarrationDurationMs(id, estimate)`, the backend estimate (about 3x too long) for a narration never played on the device; expo-audio sends no periodic update while paused, so it can stay until play. |
| Stale `didJustFinish` | `useAudioPlayer.ts` 455-457, `AudioPlayerScreen.tsx` 531-573 | Only the mounted player screen acknowledges; with the screen closed the flag stays true and fires on the next mount against the new route. |
| Sesim tab eats the finish and stops audio | `src/screens/voice/VoiceProfilesScreen.tsx` 185-193, 231-236, 354, 361 | It acknowledges every `didJustFinish`; `stopActivePreview` runs `stopAndCleanup()` whenever `audioPlayer.isPlaying`, also before "Tümünü gör" and adding a narrator; `stopAndCleanup` deletes `narration_position:<id>` (514-517). |
| Mini player never leaves | `src/components/audio/MiniPlayerDock.tsx` 103 | `visible = !!liveStory \|\| !!resting`; resting record restored after every launch. |
| Player spinner for a loaded story | `src/screens/audio/AudioPlayerScreen.tsx` 453, 479-501 | `loading` starts true and the screen awaits `getNarrationById` before the "already loaded" check. |
| Playlist unusable | `src/components/audio/PlaylistSheet.tsx` 10-12; `src/stores/PlaylistStore.ts`; backend `playlists.service.ts` `ITEM_INCLUDE` | Nothing opens the sheet; nothing adds items; narration items carry no title / cover / narrator; reorder 400s for good once a ghost row exists; queue context guessed by narration id. |
| Autoplay only on screen | `AudioPlayerScreen.tsx` 531-573, 561, 633, 656 | Screen effect + `navigation.replace` (remount, spinner, iOS loads paused). |
| Timer dead with the screen off (Android) | `src/services/SleepTimerService.ts` 398-401; RN `JavaTimerManager.kt` `onHostPause` | The deadline and the fade run only from `setInterval`; JS timers stop while the activity is paused. expo-audio status events keep arriving (`AudioPlayer.kt` coroutine on the main looper). |
| Countdown flicker | `AudioPlayerScreen.tsx` 366-374, 1046; `TimerSheet.tsx` 202, 314-321; `SleepTimerService.ts` 400 | Baloo 2 proportional digits plus `adjustsFontSizeToFit`; whole sheet re-renders every second; `setInterval` drifts against the `ceil()` deadline. |
| Mode switch moves headers | `TimerSheet.tsx` 245-354; `BottomSheet.tsx` 108-114 | Bodies of about 100 / 266 / 122dp in a bottom-anchored sheet that hugs its content. |
| Wheel runs ahead of the finger | `src/components/audio/MinuteWheel.tsx` 301 | `contentOffset` re-sent on every minute change. |
| Progress tap stall | `src/utils/playbackProgress.ts` 133-145; RN `TimingAnimation.__getNativeAnimationConfig` | One `Animated.timing` to the end of the story builds `duration / 16.67` frames (108 000 values for 30 min) on every anchor. |
| Sign-out keeps playing | `src/hooks/useAuth.ts` 113-140, 449-495 | Neither path touches the audio store or the timer. |
| `replace(null)` does not unload on Android | expo-audio `AudioModule.kt` `createMediaItem(null)` returns null, `replace` skips | `stopAndCleanup` / `failPreview` rely on it. The new model never relies on unloading. |

---

## 2. Player state model (`src/hooks/useAudioPlayer.ts`)

### 2.1 Fields

Keep the class and the singleton. Change or add these observables (MobX, `makeAutoObservable`):

| Field | Type | Meaning |
|-------|------|---------|
| `source` | `'none' \| 'story' \| 'sample'` | What the native player holds. |
| `audioId` | `string` ('' = none) | **Only** the narration whose stream is in the player (`source === 'story'`). Generation never writes it. Name kept to limit churn. |
| `isPlayingStory` | getter | `source === 'story'` (alias, keep for the existing readers). |
| `pendingNarrationId` | `string \| null` | Set synchronously when `startNarration` begins, cleared when it ends. |
| `loadPhase` | `'idle' \| 'loading' \| 'ready' \| 'failed'` | Replaces `isLoading` (keep `get isLoading() { return this.loadPhase === 'loading'; }`). |
| `loadError` | `null \| 'notFound' \| 'loadFailed' \| 'streamFailed'` | Why the last start failed. |
| `isPlaying` | `boolean` | The user's intent: true from `play()` (or an autoplay start) until a pause, the end of the story, or an external pause the store detected. Every play / pause icon draws this. |
| `isBuffering` | `boolean` | Native is waiting for data while `isPlaying` is true. |
| `storyEnded` | `boolean` | The loaded story rests at its end. Cleared by `play()`, `seek()`, `startNarration`. |
| `currentStory` | `PlayerStory \| null` | `Pick<Story, 'id' \| 'title' \| 'coverImageUrl' \| 'translationGroupId' \| 'category'>`, the five fields every reader uses (player, dock, lock screen, covers). Belongs to `audioId`. |
| `currentVoiceProfile` | `VoiceProfile \| null` | Only when a full narration is known; null for a start from a persisted record. |
| `currentNarratorName`, `currentOwnVoice` | `string \| null`, `boolean` | From the voice when known, else from the meta. The player, the dock and `buildLockScreenMetadata` read these. |
| `totalDurationMs` | `number` | Real length only (device cache or native). 0 = unknown. Never the backend estimate. |
| `dockHold` | `boolean` | True for `DOCK_PAUSE_HOLD_MS = 5000` after a pause made from the mini player. |
| `sampleKey` | `string \| null` | Key of the sample in the player (`source === 'sample'`), given by the screen that started it. |
| `previewPending`, `previewFailed` | as today | Stay, now always about `sampleKey`. |
| `pausedByBackground` | `boolean` | Free plan: the story was paused because the app went to the background (2.8). |
| `isGenerating`, `generationProgress` | as today | Generation only. |
| `generatingNarrationId`, `generatingStory`, `generatingVoiceProfile` | new | The job being generated. |
| `generationReadyId` | `string \| null` | Set when the job is READY; the generation screen reads it. |

Remove: `didJustFinish` (public), `acknowledgeFinish()`, `generationStatus` and every assignment of it (dead state, also the hard-coded 'Ses sentezleniyor...' at 669 and in `WebSocketService.ts` 448; remove the now unused `messages.narration.stage.*` keys if nothing else reads them), `cycleSpeed`, `formatTime` if unused (grep first), `isPlayerReady` if unused outside the store (grep first).

Computed getters to add:

```ts
get isStoryLoaded(): boolean { return this.source === 'story' && !!this.audioId; }
get showMiniPlayer(): boolean { return this.isStoryLoaded && (this.isPlaying || this.dockHold); }
/** The play button spins: a start or a stall the user is waiting for. */
get isBusy(): boolean { return this.isPlaying && (this.loadPhase === 'loading' || this.isBuffering); }
/** Whole minutes left at the playback speed; null while the length is unknown. */
get remainingMinutes(): number | null {
  return remainingMinutes(this.currentPositionMs, this.totalDurationMs, this.playbackSpeed);
}
```

`remainingMinutes(positionMs, durationMs, rate = 1)` in `src/utils/playbackProgress.ts` divides the time left by `rate` (audio-14). `MiniPlayerBar`'s fallback and `narrationProgress.ts` keep rate 1.

Private fields to add: `loadSeq = 0`, `lastPlayCallAt = 0`, `streamTokenAt = 0` (when the stream went into the player), `streamTokenDeadline = 0` (2.9), `streamRetried = false` (2.4, the automatic reload), `storyStartWatchdog`, `dockHoldTimer`, `storyEndHandler: ((narrationId: string) => 'advance' | 'stop') | null`, `startListener: ((narrationId: string, options: StartOptions) => void) | null`, with the setters `setStoryEndHandler()` / `setStartListener()` (installed by `bindStoryEnd`, 6.3; the store itself imports neither the queue nor the timer).

### 2.2 Status handling (`onStatusUpdate`)

Replace the body with these rules, in this order:

```ts
private onStatusUpdate(status: AudioStatus): void {
  if (this.source === 'none' || this.loadPhase === 'loading') return; // old source
  // Sample: position and length for its waveform, the preview watchdog and its end,
  // as today; nothing is saved and no narration length is remembered.
  if (this.source === 'sample') return this.onSampleStatus(status);

  // Story. A position counts once no seek is in flight and the seek's
  // confirmation window (2.4) takes it; a report it refuses was read before
  // the jump, so its end is old too (NL-01).
  const positionMs = (status.currentTime || 0) * 1000;
  const takePosition = this.pendingSeeks === 0 && this.seekConfirmation.accepts(positionMs, this.positionEpoch);
  const fromBeforeSeek = !takePosition && this.pendingSeeks === 0;
  runInAction(() => {
    if (takePosition) this.currentPositionMs = positionMs;
    if (status.duration > 0 && Number.isFinite(status.duration)) {
      this.totalDurationMs = status.duration * 1000;
      rememberNarrationDuration(this.audioId, this.totalDurationMs, this.loadedEstimateMs);
    }
  });
  if (status.didJustFinish) { if (!this.restarting && !fromBeforeSeek) this.onStoryEnd(); return; }

  const buffering = status.isBuffering === true
    || status.playbackState === 'buffering'                       // Android
    || status.timeControlStatus === 'waitingToPlayAtSpecifiedRate'; // iOS
  const ready = status.playbackState === 'ready' || status.playbackState === 'readyToPlay';
  // Idle right after the replace is the player taking the source; idle later
  // is a source that failed (a refused range request after a rewind, LR-1).
  const failed = status.playbackState === 'failed'
    || (status.playbackState === 'idle' && this.isPlaying
        && Date.now() - this.streamTokenAt > PREVIEW_IDLE_GRACE_MS);

  runInAction(() => {
    if (status.playing) {
      this.isBuffering = false;
      if (this.pausedByBackground) { /* 2.8: the native auto-resume */ this.repauseAfterBackground(); return; }
      this.isPlaying = true;            // resumed natively (focus regained, iOS remote command)
      this.clearStoryStartWatch();
    } else if (buffering) {
      this.isBuffering = this.isPlaying;
    } else if (ready && this.isPlaying && Date.now() - this.lastPlayCallAt > PLAY_SETTLE_MS) {
      // Paused outside the store: audio focus lost, a call, iOS lock screen.
      this.isPlaying = false;
      this.isBuffering = false;
      this.savePositionNow();
    }
  });
  // Once per stream an automatic reload first (2.4), then the inline error.
  if (failed) { if (!this.retryFailedStream()) this.failStoryStart(); return; }
  // Lock screen re-activation when playback resumed natively: as today (470-472).
  // Periodic position save every 3 s while isPlaying: as today (475-484).
}
```

Constants: `PLAY_SETTLE_MS = 1500` (a fresh `play()` reports `playing:false` with state ready or buffering for a moment), `STORY_START_TIMEOUT_MS = 15000`.

`onStoryEnd()` (synchronous):

```ts
private onStoryEnd(): void {
  const id = this.audioId;
  AsyncStorage.removeItem(`narration_position:${id}`).catch(() => {});
  runInAction(() => { this.storyEnded = true; this.isBuffering = false; this.dockHold = false; });
  const decision = this.storyEndHandler?.(id) ?? 'stop';   // 6.3; may call startNarration
  if (decision === 'stop') runInAction(() => { this.isPlaying = false; });
}
```

Because `startNarration` sets `loadPhase = 'loading'` and keeps `isPlaying` synchronously (2.3 step 1), an advance never lets `showMiniPlayer` drop between two stories (no dock flicker).

### 2.3 One load path: `startNarration`

```ts
export type NarrationInput =
  | { narration: StoryNarration }                    // a full narration (library row, story detail, fetched)
  | { narrationId: string; meta?: NarrationMeta };   // queue entry, continue card, route id

export interface StartOptions {
  /** Start sound once loaded. Default false. */
  autoplay?: boolean;
  /** Started by the queue (keeps the queue context, 6.3). */
  fromQueue?: boolean;
}

async startNarration(input: NarrationInput, options: StartOptions = {}): Promise<boolean>
```

Steps (all of 1 runs before the first `await`):

1. `id` from the input. **Already loaded:** if `id === this.audioId && this.isStoryLoaded && this.loadPhase !== 'failed'`: if `autoplay && !this.isPlaying` call `play()`; return true. Otherwise: `seq = ++this.loadSeq`; `loadPhase = 'loading'`; `pendingNarrationId = id`; `loadError = null`; if `autoplay` set `isPlaying = true` (intent), else leave it. Call `this.startListener?.(id, options)` (clears the queue context for a start from outside the queue, 6.3).
2. `meta = input.narration ? metaFromNarration(input.narration) : input.meta ?? getNarrationMeta(id)`.
3. No meta (route id from a push): `narration = await NarrationService.getNarrationById(id)`; 404 sets `loadError = 'notFound'`, other errors `'loadFailed'`; `loadPhase = 'failed'`, `isPlaying = false`, return false. Otherwise `meta = metaFromNarration(narration)`.
4. Outgoing story: if `this.isStoryLoaded && this.audioId !== id && this.currentPositionMs > 0` write `narration_position:<old>` now. Always `this.player?.pause()` before `replace` (Android keeps `playWhenReady=true` after a finished story and `replace` restarts a playing source; iOS restarts only if it was playing).
5. `await this.ensurePlayer()`; `token = await ApiClient.getFreshAccessToken(STREAM_TOKEN_MIN_VALIDITY_MS)` (2.9). If `!this.player`: `loadError = 'loadFailed'`, `loadPhase = 'failed'`, `isPlaying = false`, previous state untouched, return false.
6. `if (seq !== this.loadSeq) return false` (a newer start won). Repeat this check after every later await.
7. Hard flip in one `runInAction`: `source = 'story'`, `audioId = id`, `currentStory = meta.story`, `currentVoiceProfile = meta.voiceProfile ?? null`, `currentNarratorName = meta.narratorName`, `currentOwnVoice = meta.ownVoice`, `storyEnded = false`, `currentPositionMs = 0`, `positionEpoch += 1`, `totalDurationMs = knownNarrationDurationMs(id) ?? 0`, `sampleKey = null`.
8. `this.player.replace({ uri: \`${base}/narrations/${id}/stream\`, headers })`; `streamTokenAt = Date.now()`, `streamTokenDeadline = streamReloadDeadline(token, streamTokenAt)` (2.9), `streamRetried = false`; `let replaced = true`.
9. Speed (`applySpeedForNewStory`), saved position, resume decision with `resolveNarrationDurationMs(id, meta.estimateMs)` (the estimate may decide "near the end", it is never shown), `seekTo`.
10. Adopt the native length if it is already known: `const s = this.player.currentStatus; if (s?.duration > 0) { totalDurationMs = s.duration * 1000; rememberNarrationDuration(...) }` (audio-9).
11. `runInAction`: `loadPhase = 'ready'`, `pendingNarrationId = null`, `currentPositionMs = start`, `positionEpoch += 1`, `lastSavedPositionMs = start`.
12. `writeLastPlayed(recordFrom(meta, getSessionUserId()))` (4.1). `rememberNarrationMeta(meta)`.
13. `syncLockScreen()`; if `this.isPlaying` (intent, autoplay or a tap on play during the load) call the native `play()` path (2.4) and start the story-start watchdog.
14. No full narration was given: refresh in the background, never awaited by the caller: `NarrationService.getNarrationById(id).then(n => { if (this.audioId !== id) return; currentStory = n.story; currentVoiceProfile = n.voiceProfile; queueStore.updateMeta(metaFromNarration(n)); rememberNarrationMeta(...); syncLockScreen(); }).catch(() => {})`. A 404 here while it came from the queue triggers 6.7.

Catch: if `replaced`, keep the new story and set `loadPhase = 'failed'`, `loadError = 'loadFailed'`, `isPlaying = false`; otherwise the previous state was never changed. Show `msg('player.loadFailed')` once.

Rules for the advance path: nothing from step 1 to 13 may use `setTimeout` / `setInterval` (they do not fire on Android with the screen off). `ensurePlayer`, the token read, AsyncStorage and the native calls are all fine.

`loadFromNarration(narration)` becomes a thin wrapper: `startNarration({ narration })`. `pollAudioStatus` no longer calls it (2.6).

### 2.4 Controls

```ts
async play(): Promise<void>
```
- Story not loaded: no-op (callers use `startNarration`). Loading: set `isPlaying = true` and return (step 13 plays).
- `loadPhase === 'failed'`, a source that failed natively (Android `idle` more than `PREVIEW_IDLE_GRACE_MS` after its replace), or `Date.now() > streamTokenDeadline` (2.9): set `isPlaying = true` and `await this.reloadStream({ play: true })` instead of playing; a restart (below) then sets position 0, `positionEpoch += 1`, `storyEnded = false` first and the reload lands at the start ("Baştan dinle" never seeks a source whose token the backend refuses).
- Otherwise `storyEnded` (or within 500 ms of the end): `seekTo(0)`, position 0, `positionEpoch += 1`, `storyEnded = false` (this replaces the restart logic of `togglePlayPause` and `remotePlay`).
- `sleepTimerService.onPlayRequested()` (7.1). `pausedByBackground = false`. Volume back to 1 unless the timer is fading (`sleepTimerService.isFading`).
- `lastPlayCallAt = Date.now()`; `isPlaying = true`; `isBuffering = !this.player.isLoaded || this.player.isBuffering`; `this.player.play()`; `syncLockScreen(true)`; start the story-start watchdog; clear `dockHold`.

```ts
async pause(options?: { fromDock?: boolean }): Promise<void>
```
- As today (reads `player.currentTime`, saves the position at once), plus `isPlaying = false`, `isBuffering = false`, clear the watchdog.
- `fromDock`: `dockHold = true` and `dockHoldTimer = setTimeout(() => runInAction(() => { this.dockHold = false; }), DOCK_PAUSE_HOLD_MS)`. Any `play()` clears the timer.

`togglePlayPause(options?)`: `this.isPlaying ? this.pause(options) : this.play()`. No read of `player.playing` (audio-7).

`remotePlay()`: `play()` (restart handled there). Media session 'stop': unchanged (pause + `releaseLockScreen`).

`seek(seconds)`: clamp to `[0, totalDurationMs / 1000]` when the length is known (audio-21); clears `storyEnded`. A loaded story (not while loading) past `streamTokenDeadline`, or over a source that failed natively, is not sought: position = target, `positionEpoch += 1`, then `reloadStream({ play: this.isPlaying })` lands at the target (a paused story stays paused). ExoPlayer keeps no back buffer, so every rewind is a new range request with the header token (LR-1). The 15 s skips, the lock screen seek and the previous button (`playPrevious` seeks 0) all go through `seek`.

Seek confirmation window (NL-01, `SeekConfirmation` in `src/utils/playbackProgress.ts`): the player can deliver a status it read before the jump after `seekTo` returned (4 of 4 rewinds on the emulator). `seek()` and the restart in `play()` call `seekConfirmation.begin(targetMs, positionEpoch, playbackSpeed)` after bumping the epoch and `landed(epoch)` when `seekTo` settles. Until then reports are ignored (`pendingSeeks`); after it only a report near the target counts: from `target - DRIFT_TOLERANCE_MS` to `target + (now - sent) * rate + DRIFT_TOLERANCE_MS`. The first such report ends the window; `SEEK_CONFIRM_MS` (1 000 ms) after `landed` any report counts again (a seek the player did not follow is corrected within a second); any other epoch bump (new track, reload, restart, sample, a failed seek's revert) ends it. A `didJustFinish` in a refused report is not an end. The clock, the saved position and the progress driver all read the guarded `currentPositionMs`.

Story-start watchdog: started by every native `play()` of a story; cleared by the first status with `playing: true`. On timeout, or on a `failed` / idle status after `PREVIEW_IDLE_GRACE_MS` (2.2), `failStoryStart()`: `player.pause()`, `isPlaying = false`, `loadError = 'streamFailed'`. The player shows the inline error (5.5); it never toasts.

Automatic reload (LR-1): a story source that failed natively while `loadPhase === 'ready'` (a `failed` / idle status, 2.2, or a watchdog timeout over a native `idle` that came inside the grace) is first reloaded once at `currentPositionMs` (`retryFailedStream`: `streamRetried = true`, `reloadStream({ automatic: true })`, which asks `getFreshAccessToken(Number.POSITIVE_INFINITY)`, a forced refresh: the backend refused the token or the device clock runs off). No error and no toast meanwhile (the play button spins). Only a failure of that stream again shows the inline error. `streamRetried` is cleared by every deliberate load (`startNarration`, a reload from play / seek / "Tekrar dene") and by the first sounding status, so one stream never loops. No JS timer is added on the advance path.

`reloadStream(options?: { play?: boolean; automatic?: boolean })`: fresh token (`STREAM_TOKEN_MIN_VALIDITY_MS`, or a forced refresh when `automatic`), `replace` with the new header, new `streamTokenAt` / `streamTokenDeadline`, seek to `currentPositionMs` (0 at the end), keep `isPlaying` (or `play` when given), restart the watchdog. Used by the inline "Tekrar dene", by `play()` and `seek()` past the deadline, and by the automatic reload.

### 2.5 Samples

```ts
async playFromUrl(url: string, meta: { key: string; title?: string }): Promise<void>
async stopPreview(key?: string): Promise<void>
```
- `playFromUrl`: if a story is playing, `await this.pause()` first (saves the exact position, r11-4). Then `lockScreen.deactivate()` and `replace({ uri: url })`. The story leaves the player: `source = 'sample'`, `sampleKey = meta.key`, `audioId = ''`, `currentStory = null`, `currentVoiceProfile = null`, `totalDurationMs = 0`, `currentPositionMs = 0`, `storyEnded = false`. Its position is saved, and `lastPlayed` plus the meta cache still describe it, so the continue card and the player screen can start it again instantly. The sample's native `play()` and `watchPreview()` as today.
- The sample ends (`didJustFinish` with `source === 'sample'`) or fails: `sampleKey = null`, `isPlaying = false`, `source = 'none'`. No acknowledgement by screens.
- `stopPreview(key)`: only when `source === 'sample'` and (`key` undefined or `key === sampleKey`): pause, `sampleKey = null`, `source = 'none'`, `isPlaying = false`. It never touches a story or a saved position.
- `stopAndCleanup()` keeps its name for `reset()` / `unloadForSignOut()` only and never deletes `narration_position:*` (it writes it when a story with a position is loaded).

Screens derive their state from the store:

| File | Change |
|------|--------|
| `src/screens/voice/VoiceProfilesScreen.tsx` | Delete the `didJustFinish` effect (185-193). `isPlayingKey = key => audio.sampleKey === key && audio.isPlaying`; `isLoadingKey = key => loadingPreviewId === key \|\| (audio.sampleKey === key && audio.previewPending)`. `stopActivePreview = () => audio.stopPreview()` (no story stop). Remove the calls before `handlePresetPress` and `openCatalogue` (354, 361). Sample progress: a `SampleProgress` observer mounted only in the previewing card reads `currentPositionMs` (perf-4); the screen body no longer reads `currentPositionMs` / `totalDurationMs`. |
| `src/components/detail/useNarratorPreview.ts` | Same: `playingId = audio.sampleKey` when it is one of its keys; `stop()` calls `stopPreview(key)`; delete the finish effect; add the tap-race token (test-18): `const token = ++tokenRef.current` before `loadUrl()`, return if stale after it and after `playFromUrl`, clear `loadingId` only for the latest token. |
| `src/screens/voice/VoiceSuccessScreen.tsx` | Delete the finish effect (78-83); `isPreviewing = audio.sampleKey === SUCCESS_SAMPLE_KEY`; unmount and stop call `stopPreview(SUCCESS_SAMPLE_KEY)`. |

### 2.6 Generation, kept apart from playback

- `beginGenerationSession()`, `generateAudio()`, `trackExistingNarration()` write `generatingStory`, `generatingVoiceProfile`, `generatingNarrationId`, `isGenerating`, `generationProgress` only. `pollAudioStatus()` reads `generatingNarrationId`.
- READY: `generationProgress = 100`, `isGenerating = false`, `generationReadyId = generatingNarrationId`. **Do not load.** FAILED / timeout as today.
- `generationProgress` is monotonic within a session (`Math.max`), reset by `beginGenerationSession` (audio-19, part that touches the store).
- `WebSocketService.ts`: the bridge interface (97-102) becomes `{ generatingNarrationId: string | null; isGenerating: boolean; generationProgress: number; generationReadyId: string | null }`; compare against `generatingNarrationId` (437); drop the `generationStatus` writes.
- `AudioGenerationScreen.tsx`: `sameJobRunning` uses `generatingStory?.id` / `generatingVoiceProfile?.id`; cover, glow and subtitle use the generating fields; the auto-navigate effect waits for `generationReadyId` and then:
  - a story is playing (`audio.isStoryLoaded && audio.isPlaying`): do not navigate; the dock button becomes a primary "Dinle" (`generation:listen`, new key) that runs the case below;
  - otherwise: `navigation.replace('AudioPlayer', { narrationId: generationReadyId, autoplay: true })`.
- After a READY with `replace: true` (regenerate): if the queue holds an entry for the same `(storyId, voiceProfileId)`, fetch the new narration (`getNarrationById(readyId)`) and call `queueStore.replaceNarration(storyId, voiceProfileId, metaFromNarration(n))` (6.7).

### 2.7 Sign-out and session expiry

- Export `getAudioPlayerStoreIfCreated(): AudioPlayerStore | null` (never creates the store).
- `async unloadForSignOut()`: `await this.pause()` (keeps positions), `lockScreen.deactivate()`, `clearPreviewWatch()`, clear the watchdog and `dockHold`, then `source = 'none'`, `audioId = ''`, `currentStory = null`, `currentVoiceProfile = null`, `totalDurationMs = 0`, `currentPositionMs = 0`, `storyEnded = false`, `sampleKey = null`, generation fields cleared, `stopPolling()`.
- `src/hooks/useAuth.ts` `handleSessionExpired` and `signOut`, before the `runInAction` that clears the user: `await getAudioPlayerStoreIfCreated()?.unloadForSignOut(); sleepTimerService.turnOff(); queueStore.reset(); setSessionUserId(null);`. Delete `prefetchPlaylists` and its five calls (185, 269, 310, 348, 396) and the `playlistService.clear()` / `playlistStore.reset()` blocks (130, 483-484).
- New `src/stores/session.ts`: `setSessionUserId(id: string | null)`, `getSessionUserId(): string | null`. `AuthStore` calls it wherever `backendUser` is set or cleared, and then `void queueStore.hydrate(id)`. The audio store and the queue never import `useAuth` (Firebase).

### 2.8 One session bridge, and the free plan in the background

`useAudioPlayer()` becomes `useMemo(getAudioPlayerStore, [])`. `getAudioPlayerStore()` (exported) creates the singleton once (`registerAudioPlayerStore`, `bindPlaybackProgress`) and has no effects (perf-10 / audio-16).

New `src/components/audio/AudioSessionBridge.tsx` (an `observer`, renders null), mounted once in `RootNavigator` inside `NavigationContainer` next to `QueueSheetHost` (6.5). It is mounted from the Splash route on, so it exists before anything can play. On mount it runs `bindStoryEnd(getAudioPlayerStore(), queueStore, sleepTimerService)` and `sleepTimerService.attachPlayer(getAudioPlayerStore())` (disposed on unmount). Doing the wiring here, not inside `useAudioPlayer.ts`, keeps the store free of an import cycle with `queuePlayback.ts`. It also:
- Tier effect: on `isPro` change, `setAudioModeAsync(playbackAudioMode(isPro))` and `store.syncLockScreen(store.isPlaying)` (moved from the hook, 1218-1224).
- One `AppState` listener:
  - `'background'`, free plan, `store.isStoryLoaded && store.isPlaying`: `store.pause()`, `store.setVolume(0)` (silences expo-audio's native auto-resume, see below), `pausedByBackground = true`. No snackbar (nobody sees it).
  - `'active'` with `pausedByBackground`: `showToast.info(msg('player.pausedOnLock'), msg('player.pausedOnLockTitle'), { label: msg('player.resume'), onPress: () => void store.play() })`, once.
- Why the volume: with `shouldPlayInBackground: false` expo-audio pauses natively on background and calls `play()` again on foreground (`AudioModule.kt` 247-276, iOS `AudioModule.swift` 98-115). The store re-pauses that resume in `onStatusUpdate` (`repauseAfterBackground`: `player.pause()`, keep `isPlaying = false`); at volume 0 it is inaudible. `play()` puts the volume back to 1.
- `msg('player.backgroundPaid')` and `backgroundPaidTitle` are removed.

### 2.9 Stream token and narration metadata

- `src/services/ApiClient.ts`: `async getFreshAccessToken(minValidityMs = 120000): Promise<string | null>`: decode the JWT payload (`jwtExpiryMs`: base64url, `exp`, with the global `atob` of RN 0.74+; a token that cannot be decoded counts as expiring), and if it expires within `minValidityMs` return `await this.refreshSession()`, else the stored token (`Number.POSITIVE_INFINITY` always refreshes). A refresh that fails returns the stored token while it is still valid for the default 2 minutes (a network blip on the refresh must not break a stream the old token still carries), else null (a refused refresh token has cleared the session and runs the session-expired flow); the store then streams without a header and the usual failure path applies. Used by `startNarration` and `reloadStream`. The backend JWT lives 1 h; a paused stream or a background advance after that otherwise fails silently.
- Stream token (LR-1). ExoPlayer keeps no back buffer: every rewind ("15 saniye geri", "Baştan dinle", a tap on the bar behind the knob) and every re-buffer is a new range request with the header token, and a token that expired answers 401 ("Masal oynatılamadı"). So:
  - Constants: `STREAM_TOKEN_MAX_AGE_MS = 50 min` (the reload window), `STREAM_TOKEN_MARGIN_MS = 5 min`, `STREAM_TOKEN_MIN_VALIDITY_MS = STREAM_TOKEN_MAX_AGE_MS + STREAM_TOKEN_MARGIN_MS` (55 min). A stream starts and reloads with `getFreshAccessToken(STREAM_TOKEN_MIN_VALIDITY_MS)`: with the 1 h JWT a token older than 5 minutes is refreshed first, so the backend accepts every request until the next reload.
  - `streamReloadDeadline(token, loadedAt)` (exported): `min(loadedAt + STREAM_TOKEN_MAX_AGE_MS, jwtExpiryMs(token) - STREAM_TOKEN_MARGIN_MS)`; the fixed window for a token that cannot be decoded. Stored as `streamTokenDeadline` at every replace; it covers a backend with shorter JWTs and a refresh that failed and kept the old token.
  - `play()` and `seek()` reload first once `Date.now() > streamTokenDeadline` (2.4); a source that fails anyway gets one automatic reload before the inline error (2.4).
- New `src/stores/narrationMeta.ts`:

```ts
export interface NarrationMeta {
  readonly narrationId: string;
  readonly storyId: string;
  readonly voiceProfileId: string | null;
  /** What the player, the dock and the lock screen draw. */
  readonly story: { id: string; title: string; coverImageUrl: string | null;
                    translationGroupId: string | null; category: string | null };
  readonly voiceProfile: VoiceProfile | null;   // when known (from a full narration)
  readonly narratorName: string | null;          // getNarratorDisplay(voice)?.name
  readonly ownVoice: boolean;                    // isCloneProfile(voice)
  /** The backend's length estimate in ms (never shown in the player). */
  readonly estimateMs: number;
}
export function metaFromNarration(n: StoryNarration): NarrationMeta;
export function rememberNarrationMeta(meta: NarrationMeta): void;   // observable map, memory only, 300 entries
export function getNarrationMeta(id: string): NarrationMeta | null;
```

`MyLibraryScreen` remembers the meta of every loaded page; `StoryDetailScreen` the narrations of its story; the queue and `lastPlayed` records are metas already. Persisted metas (queue entries, `lastPlayed`) drop `voiceProfile` (a model object with dates) and keep `voiceProfileId`, `narratorName`, `ownVoice`; they read back with `voiceProfile: null`.

### 2.10 Call sites to migrate

`audio.didJustFinish` / `acknowledgeFinish` (`AudioPlayerScreen`, `VoiceProfilesScreen`, `useNarratorPreview`, `VoiceSuccessScreen`, test mocks); `audio.isLoading`; `audio.loadFromNarration` (player screen); `audio.generationStatus`; `audio.audioId` read as the generation id (`AudioGenerationScreen` 194-215, `WebSocketService` 437); `stopAndCleanup` (3 voice files); `MiniPlayerDock`; `NarrationRow` (`active = player.audioId === n.id && player.isStoryLoaded`); `src/test-utils/mocks/native-modules.ts` / `services.ts`.

### 2.11 Tests (`src/hooks/useAudioPlayer.test.ts` unless noted)

- Generation: with A loaded and playing, `generateAudio(B)` leaves `audioId`, `currentStory`, `currentVoiceProfile` at A; a status update during it writes `narration_position:A` only and `knownNarrationDurationMs(B)` stays null; a READY poll never calls `player.replace` and sets `generationReadyId`.
- `WebSocketService.test.ts`: a `narration_status` for `generatingNarrationId` updates progress while `audioId` is A; 65 then 60 keeps 65.
- `AudioGenerationScreen.test.tsx`: READY navigates with `{ narrationId: readyId, autoplay: true }`; with a story playing it shows "Dinle" and does not navigate.
- Intent: after `play()`, a status `{ playing: false, isBuffering: true }` keeps `isPlaying` and sets `isBuffering`; `togglePlayPause` then calls `player.pause`, not `player.play`; a status `{ playing: false, playbackState: 'ready' }` 2 s after play clears `isPlaying` and saves the position; the same within `PLAY_SETTLE_MS` does not; `{ playing: true }` after an external pause sets `isPlaying` again.
- `startNarration`: pauses before `replace` in every case; a failing `ensurePlayer` leaves the previous story untouched; a second start during the first wins (`loadSeq`); with `autoplay` it plays after the seek; already loaded + autoplay + paused plays without `replace`; meta input streams without `getNarrationById` and refreshes in the background; the player length is real only (backend 900 s, no cache: `totalDurationMs` 0; `currentStatus.duration` 300 at load: 300 000).
- End: `didJustFinish` with no handler sets `storyEnded`, clears `isPlaying` and the saved position; with a handler that returns 'advance', `showMiniPlayer` never reads false between the two stories (record every value through a `reaction`).
- Samples: `playFromUrl` over a playing story saves its position first; `stopPreview()` with a story loaded is a no-op; a sample end sets `sampleKey` null and never calls a story end handler; `stopAndCleanup` keeps `narration_position:<id>`.
- Watchdog (fake timers): no `playing:true` within 15 s sets `loadError: 'streamFailed'`; an iOS `playbackState: 'failed'` or Android `'idle'` after the grace does too; a sounding status clears it.
- Token: the stream starts (and reloads) with a token asked for at least `STREAM_TOKEN_MAX_AGE_MS` (`STREAM_TOKEN_MIN_VALIDITY_MS`); `play()` after 51 minutes calls `getFreshAccessToken` and `replace` with the new header before `play`; a seek after the deadline reloads the stream at the seek target (paused stays paused; a 15 s rewind while playing plays at the target; a token with 16 min left moves the deadline to 11 min); "Baştan dinle" after the deadline reloads at 0 with no seek on the old stream; a native source failure while playing triggers one `reloadStream` at the current position (forced refresh) and no error, a second failure shows the inline error; a sounding stream and the inline retry earn a new automatic reload; an idle report inside the grace is reloaded once by the watchdog; `useAudioPlayer.mediaSession.test.ts`: a lock-screen skip back after the deadline reloads at the target. `ApiClient.test.ts`: `getFreshAccessToken` refreshes a token expiring in 60 s and returns a valid one as is; `getFreshAccessToken(55 min)` refreshes a token with 30 min left; a failed refresh keeps a token with 30 min left and resolves null for one about to expire or when the refresh token is refused; `Number.POSITIVE_INFINITY` always refreshes.
- `seek(400)` with a 300 s story calls `seekTo(300)`; `remainingMinutes` at 2,0x with 10 min left is 5 (`playbackProgress.test.ts` too).
- Seek confirmation (NL-01): a 15 s rewind from 1:54, then a report at 114,4 s 450 ms later keeps `currentPositionMs` 99 000, `positionSeconds` 99 and a bound driver at the target; the next report near the target (99,9 s) counts and so does every later one; after `SEEK_CONFIRM_MS` a report far from the target counts; a forward skip and a seek while paused take the first report near the target; a new story right after a seek takes its own reports at once; an old `didJustFinish` right after a restart landed ends nothing.
- `useAuth.test.ts`: `signOut` and `handleSessionExpired` call `unloadForSignOut` on an existing store, `sleepTimerService.turnOff`, `queueStore.reset`; they create no store when none exists; no playlist request at session restore.
- `AudioSessionBridge.test.tsx`: ten components calling `useAudioPlayer()` cause one `setAudioModeAsync` and one `AppState` listener; free + background pauses with no snackbar and volume 0; then a native `{ playing: true }` status is paused again; `'active'` shows one snackbar whose action plays; Pro + background does nothing.
- Voice screens: `VoiceProfilesScreen.test.tsx` "Tümünü gör while a story plays does not stop it", "adding a narrator while a story plays does not stop it", "a story finishing does not reset this screen's buttons"; `detail.test.tsx` "tapping B while A is still loading plays only B".

---

## 3. Mini player

### 3.1 Show / hide rule

Visible exactly when `audio.showMiniPlayer` is true: a story is in the player and it plays (intent, so loading with autoplay and buffering count), or for 5 s after a pause made from the mini player's own button. Hidden when paused anywhere else (player screen, lock screen, notification, headset, audio focus, sleep timer), finished, after a sample took the player, after a restart, after sign-out. No resting record is ever docked.

### 3.2 Layout, inset and motion (`src/screens/main/MainScaffold.tsx`)

- Move the dock out of the tab bar. `MainScaffold` keeps `const [barHeight, setBarHeight] = useState(NAV_BAR_HEIGHT + insets.bottom)`, passes `onBarLayout={setBarHeight}` to `MainBottomBar` through the `tabBar` render prop, and renders after `Tab.Navigator`, inside its root `View` (so touches land inside the parent's bounds on Android), a `MiniPlayerOverlay`: `position: 'absolute'`, `left: 0`, `right: 0`, `bottom: barHeight`. It contains the 40dp fade (`T.space.xxxl`, same gradient as today) and the card with `marginBottom: T.space.xs` (4, the mockup gap). The scene height never changes.
- `MainBottomBar` keeps only the nav bar. `snackbar.setBottomInset(barHeight + (showMiniPlayer ? MINI_PLAYER_DOCK_HEIGHT : 0))` while the shell is focused.
- New `src/components/audio/useMiniPlayerInset.ts`: `useMiniPlayerInset(): number` returns `MINI_PLAYER_DOCK_HEIGHT + T.space.sm` while `showMiniPlayer`, else 0. `HomeScreen`, `StoryLibraryScreen`, `MyLibraryScreen` (both FlatLists) and `VoiceProfilesScreen` add it to their scroll `contentContainerStyle.paddingBottom` (after `T.tabBarReservedHeight`).
- Constants in `MiniPlayerBar.tsx` (module scope, so literals): `MINI_PLAYER_LIP = 3` (equals `T.lipSize.md`), card `minHeight: 60` (cover 44 + 2 x 8), `MINI_PLAYER_HEIGHT = 60 + MINI_PLAYER_LIP` (63), `MINI_PLAYER_DOCK_HEIGHT = MINI_PLAYER_HEIGHT + 4` (67, the 4 is `T.space.xs`). A test asserts the literals match the tokens.
- Motion (the overlay owns a local `rendered` state so the exit can play): show: opacity 0 to 1 and translateY 12 to 0, 200 ms, `Easing.out(Easing.cubic)`, native driver; hide: the reverse in 150 ms with `Easing.in(Easing.cubic)`, then unmount. Mounted while already visible (back from the player): no animation. Reduce motion: opacity only, 100 ms. Use the motion tokens of the controls/motion spec if it lands first; these are the values.
- `MiniPlayerDock` becomes a thin observer: renders `MiniPlayerBar` from the store when `showMiniPlayer`; delete the resting state, `lastPlayed` reads and writes, `useAuth`, and the `onVisibleChange` prop. Toggle: `audio.togglePlayPause({ fromDock: true })`. Body: `nav.navigate('AudioPlayer', { narrationId: audio.audioId })` (loaded, so instant). Title `audio.currentStory?.title ?? t('player:untitled')`; narrator `audio.currentNarratorName`, wave colour from `audio.currentOwnVoice`; busy: `audio.isBusy`.
- Update the "Shell" paragraph of `CLAUDE.md` ("once something was played") and the `MainScaffold.tsx` header comment.

### 3.3 `MiniPlayerBar` fixes (`src/components/design/MiniPlayerBar.tsx`)

- `usePressSink(T.lipSize.md)` (sinks 4 on a 3dp lip today, lip-2).
- `trackWidth` seeded with 0 (AnimatedFill draws nothing until measured; the seed `windowWidth - 52` is 20dp too wide, bug-1).
- New `busy?: boolean`: a 20dp `Spinner` in `T.onAction` replaces the play / pause glyph.
- Spacing to the scale: `paddingLeft/Right 9` to 8, main `gap 11` to 12, `paddingVertical 9` to 8, subtitle `gap 5` to 4, progress `bottom 5` to 4.
- testIDs `mini-player-card` (Animated.View) and `mini-player-lip`.

### 3.4 Tests

- `MainScaffold.test.tsx`: replace "docks the last played story after a restart; play opens the player" with "shows nothing after a restart even with a remembered story"; replace "remembers the playing story on the device" with a store test (4.5). Add: "hides when paused outside the dock", "stays 5 s after a pause from its own button, then hides" (fake timers), "hides after the story finished", "hides while a sample plays", "stays visible while the next queued story loads", "the tab scene keeps its height when the mini player appears" (main-bottom-chrome height unchanged, overlay absolute), "the snackbar inset grows by MINI_PLAYER_DOCK_HEIGHT while it shows", "Animated.timing toward translateY 0 runs on show and none on a mount while visible".
- `components.test.tsx` MiniPlayerBar: sink outputRange `[0, 3]`; no `mini-player-progress` before a layout event; `busy` shows the spinner and keeps the 44dp button.
- `useMiniPlayerInset.test.ts`: 0 when hidden, `67 + 8` when visible.

---

## 4. Library "Kaldığın yerden devam et"

### 4.1 Record (`src/utils/lastPlayed.ts`)

Extend `LastPlayed` to the `NarrationMeta` fields plus `userId: string | null` and `updatedAt: number` (parse: default 0; missing fields default as today). Add `clearLastPlayed()`. The store writes it in `startNarration` step 12 (never the dock, never a sample, never generation). The playback position stays under `narration_position:<id>` (written every 3 s while playing and on every pause; removed at the end of the story).

### 4.2 `src/hooks/useLastListened.ts`

```ts
export interface LastListened {
  record: LastPlayed;
  positionMs: number;     // live from the store when that story is loaded, else saved
  durationMs: number;     // resolveNarrationDurationMs(id, record.estimateMs)
  live: boolean;          // the record's story is the one in the player
}
export function useLastListened(): LastListened | null
```
- Reads `readLastPlayed(getSessionUserId())` and `readSavedPositionMs` in `useFocusEffect`, and again when `audio.audioId` or `audio.isPlaying` change while focused.
- Returns null when there is no record for this account, no resumable position (`shouldResumeFrom(positionMs, durationMs / 1000)` false: never played or finished), or when, **at the moment the Library gained focus**, that story was loaded and playing (the mini player shows it). While the screen stays focused the card does not disappear when its story starts (no list jump); it turns live instead.

### 4.3 `src/components/library/ContinueListeningCard.tsx`

On `LibraryRowCard` (same 22dp card on its 3dp lip, so it aligns with the rows):
- Eyebrow `t('library:continue.eyebrow')` ("Kaldığın yerden devam et"), `text.meta`, `T.text2`, above the card with `marginBottom: T.space.xs`, inside the same gutter.
- Body: 52dp cover (`LIBRARY_COVER_WIDTH`, radius 16, `translationGroupId` from the record), title `labelLarge` one line, meta `nav:miniPlayer.narratorRemaining` ("Kerem anlatıyor, 6 dk kaldı"; narrator-less: `library:row.remaining`), a 48dp-wide 3dp `ProgressBar` (`progress={playbackProgress.progress}` when live, else `value={positionMs / durationMs}`).
- Trailing `CircleButton` variant 'action', icon `pause` when live and playing, else `play`, busy spinner while `audio.isBusy` for that story (new `busy?: boolean` prop on `CircleButton` in `src/components/design/feedback.tsx`: a 20dp `Spinner` in place of the glyph, same size; `NarrationRow` uses it too); a11y `t('library:continue.a11y', { title })`.
- testIDs `library-continue`, `library-continue-play`.

### 4.4 Placement and behaviour (`src/screens/library/MyLibraryScreen.tsx`)

- Masallarım only, not while `appliedSearch` is non-empty. Rendered as the first element of the `ListHeaderComponent`, above the count row, also while the rows skeleton shows (the record is local; render it above `rowsSkeleton`) and when the list is empty.
- Play button: live: `audio.togglePlayPause()`; else `audio.startNarration({ narrationId: record.narrationId, meta: record }, { autoplay: true })`. Resumes in place, no navigation. The mini player appears because the story now plays.
- Body: `rememberNarrationMeta(record)` then `nav.navigate('AudioPlayer', { narrationId, autoplay: true })` (5.2 rule).
- A start that fails with `loadError === 'notFound'` (the narration was deleted or regenerated): `clearLastPlayed()`, `showToast.info(msg('player.notFound'))`, the card disappears.

### 4.5 Tests

- `ContinueListeningCard.test.tsx` / `MyLibraryScreen.test.tsx`: shown for a saved 180 000 of 240 000 ms with "Kerem anlatıyor, 1 dk kaldı"; hidden for another account, with no position, with a finished position, on Kaydedilenler, while searching, and when its story was playing when the tab gained focus (use `setMockFocused` from test-10); stays and turns live when its play button is pressed; shown above the skeleton; play calls `startNarration` with `autoplay: true` and does not navigate; body navigates with `autoplay: true`; a 'notFound' start clears the record and hides the card.
- `useAudioPlayer.test.ts`: `startNarration` writes `lastPlayed` with `userId` and `updatedAt`; a sample and a generation never write it.
- `lastPlayed.test.ts` (new): v1 records parse with `updatedAt` 0; `clearLastPlayed` removes the key.

---

## 5. Player screen (`src/screens/audio/AudioPlayerScreen.tsx`)

### 5.1 Route and render states

`RootStackParamList.AudioPlayer = { narrationId: string; autoplay?: boolean }` (`src/navigation/RootNavigator.tsx` 126; also `pushRouting.ts` `NotificationRoute`).

```ts
const narrationId = route.params.narrationId;
const loaded = audio.audioId === narrationId && audio.isStoryLoaded;
const starting = audio.pendingNarrationId === narrationId;
const meta = loaded ? storeMeta(audio) : getNarrationMeta(narrationId);
```
- On mount and when `narrationId` changes: if `!loaded && !starting` call `audio.startNarration(meta ? { narrationId, meta } : { narrationId }, { autoplay: !!route.params.autoplay })`. If `loaded && route.params.autoplay && !audio.isPlaying` call `audio.play()`. Then `navigation.setParams({ autoplay: undefined })`. Decide at call time, not from a render flag in the effect's deps.
- Render the full player whenever `meta` or the store's story is known. Never show a story other than the route's: title, cover, narrator come from the store only when `audio.audioId === narrationId` or `pendingNarrationId === narrationId`, else from `meta`.
- Full-screen `LoadingLine` (spinner + "Masal yükleniyor...", the close button in place) only when nothing is known about the narration (push tap, deep link) and its fetch runs.
- Full-screen error only for `loadError === 'notFound'`, or `'loadFailed'` with no meta: as today, "Tekrar dene" calls `startNarration` again.
- `loading` / `loadError` / `narration` local states are deleted.
- Remove `sleepTimerService.attachPlayer` from the screen (2.8). Keep `void sleepTimerService.initialize()`.

### 5.2 Entry points and `autoplay`

Rule: an entry that stays where it is (a play button in a list or card) calls `startNarration` itself; an entry that opens the player only calls `rememberNarrationMeta(meta)` and navigates with the right `autoplay`, and the screen starts the narration on mount, instantly because the meta is known.

| Entry | Call | autoplay |
|-------|------|----------|
| Library row play button (`NarrationRow` trailing) | loaded: toggle; else `startNarration({ narration }, { autoplay: true })`, no navigation | true |
| Library row body | `rememberNarrationMeta`, navigate | false |
| Continue card play / body | 4.4 | true |
| Mini player body | navigate (loaded) | n/a |
| Queue row, "Sırayı çal", "Hepsini çal" | `playQueueFrom` (6.3); navigate only when the sheet was opened outside the player | true |
| StoryDetail "Dinle" of a ready narration (today the `existingDialog.listen` button) | `rememberNarrationMeta`, navigate | true |
| Generation READY (6, 2.6) | replace | true |
| In-app "Masalın hazır" snackbar action (ux-21, owned by the notifications spec) | navigate | true |
| Push tap, notifications list | navigate | false |

### 5.3 Track changes without a remount

- Delete the finish effect (529-573), `findNext`, and every `navigation.replace('AudioPlayer', ...)` (561, 633, 656).
- Add: `useEffect(() => reaction(() => audio.pendingNarrationId ?? audio.audioId, id => { if (id && id !== routeIdRef.current && (focusedRef.current || queueStore.currentId === id)) navigation.setParams({ narrationId: id }); }), [audio, navigation])`, with `routeIdRef` / `focusedRef` kept current by the render (the reaction is created once). The new track renders at once from its meta (no spinner, 5.1). Cover and glow: `PictureCover` as is; the glow `ExpoImage` gets `transition={200}`.
- `perf-3`: with the finish logic in the store, the player screen may be frozen when blurred; no `freezeOnBlur: false` is needed for it.

### 5.4 Top bar, title, transport

- Top bar right: the "more" glass button is replaced by the queue button: `IconButton variant="glass" icon="queue"` with the new `badge` prop (`queueStore.entries.length`, hidden at 0), a11y `t('queue.a11yOpen', { n })`, `onPress={() => queueSheet.open('player')}` (6.5). The one-choice "more" dialog (ux-26) disappears.
- Caption: in queue context `captionTop` reads `t('queue.position', { index, total })` ("Sıra 2/5"), else `t('nowPlaying')`; `captionMain` stays the category.
- Title: `accessibilityRole="link"`, `onPress` opens `StoryDetail` (`storyId`). a11y hint `t('openStory')`.
- Transport sizes (btn-4, R4; use the design-system round-button tokens if that spec defines them, these are the dp targets): play 80 on `T.lipSize.lg` (4), glyph 34; skip 56 on `T.lipSize.md`, glyph 28; side 40 with `hitSlop={{ left: 4, right: 4 }}` (new `IconButton` prop, audio-23); gap 28 (`T.space.xxl`) without queue, 8 with queue (304dp at 360). `transportLayout` keeps the same shape.
- Previous / next: shown only in queue context with 2 or more entries. Next disabled (`IconButton disabled`) when there is no next entry; it never seeks to the end. Previous: position over 5 s restarts (`seek(0)`), else `playPrevious()`; disabled only on the first entry within its first 5 s. `t('skipped')` is deleted (story-only rows no longer exist).
- Play face: `audio.isBusy` for this narration shows a 28dp `Spinner` in `T.onAction`; otherwise the play / pause glyph from `audio.isPlaying`. Pressing play when the narration is not the loaded one (a sample took the player meanwhile): `startNarration({ narrationId, meta }, { autoplay: true })`.
- Seek knob grab: `Animated.timing` 0 to 1 in 120 ms (native) driving scale 1 to 1.15 (r14-seek-knob).
- Spacing: `byRow gap 7` to 8, `marginTop 6` to 4; title `marginTop 20` to 16; `opts marginTop 22` to 16; `timeRow marginTop -6` to -8.

### 5.5 Inline stream error

`loadError === 'streamFailed'` or `'loadFailed'` with meta: under the transport (above the tiles), a `Card` row: `StateIcon` alert, `t('streamFailed')` ("Masal oynatılamadı."), text Button `common:retry` calling `audio.reloadStream()` (streamFailed) or `startNarration` (loadFailed). testID `player-stream-error`. The tiles stay.

### 5.6 Tests (`AudioPlayerScreen.test.tsx`)

Replace "shows the loading state until the narration arrives", "does not reload a narration that is already loaded", "has no ... playlist entry", "more offers the story page", the four queue tests (599-690) and the three timer-advance tests (700-775) with:
- "opens instantly on the loaded story": `getNarrationById` never resolves; `player-screen` renders on the first frame, `startNarration` not called.
- "opens instantly with known meta": not loaded, meta remembered; `player-screen` renders, play face busy with autoplay, `startNarration` called once with `{ narrationId, meta }`.
- "shows the loading line only for an unknown narration"; "a failed background refresh keeps the player".
- "autoplay param plays once and is cleared"; "already loaded, finished and autoplay restarts it".
- "never shows the previous narration's title during a switch" (setParams to B while B is pending).
- "a queue advance calls setParams, never replace".
- "previous and next only in queue context; next disabled at the end and does not seek; previous restarts after 5 s".
- "the queue button opens the queue sheet and shows the count"; "the title opens the story page".
- "busy spinner while loading or buffering with the intent to play".
- "stream error shows the inline retry; retry calls reloadStream".
- "the seek knob grab animates on the native driver".
- Transport sizes: `transportLayout(false)` `{ skip: 56, gap: 28 }`, play face width 80, `player-play-lip` top 4.

---

## 6. Queue "Sıradakiler"

### 6.1 Why a local queue

The backend playlist would need four backend changes before it is usable (narration items carry no title / cover / narrator; no duplicate guard; ghost rows after a regenerate or a voice delete make every reorder a 400 for good; no bulk add), and every move, remove and add would wait on the network and race (r12-4, r12-5, r12-6, test-13). A local queue has none of these problems, works offline and with the screen off, opens with no loading state and costs no request at login. A bedtime queue gains little from syncing between devices; named, synced lists can come back later on the existing `/playlists` endpoints.

So: delete `src/stores/PlaylistStore.ts` (+ test), `src/components/audio/PlaylistSheet.tsx` (+ test), `src/services/PlaylistService.ts` (+ test), `src/models/Playlist.ts`, their mocks in `src/test-utils/mocks/services.ts`, and the `player:playlist.*` keys (replaced by `player:queue.*`). Add a superseding note to `docs/REDESIGN_DECISION_LOG.md` 4.4. The backend module stays untouched.

### 6.2 `src/stores/QueueStore.ts`

```ts
export type QueueEntry = NarrationMeta & { readonly addedAt: number };
export const QUEUE_MAX = 50;
export const QUEUE_STORAGE_PREFIX = '@sesly/queue:v1:';   // + userId

class QueueStore {
  entries: QueueEntry[] = [];
  /** narrationId of the entry playback is on, when it came from the queue; else null. */
  currentId: string | null = null;
  hydrated = false;

  async hydrate(userId: string | null): Promise<void>; // reads `${prefix}${userId}`; null userId: empty
  reset(): void;                                     // memory only (sign-out)

  has(narrationId: string): boolean;
  add(meta: NarrationMeta): 'added' | 'exists' | 'full';
  /** "Hepsini çal": replace the queue; returns the previous state for undo. */
  replaceAll(metas: readonly NarrationMeta[]): QueueSnapshot;
  remove(narrationId: string): { entry: QueueEntry; index: number } | null;
  restore(removed: { entry: QueueEntry; index: number }): void;
  restoreSnapshot(snapshot: QueueSnapshot): void;
  move(fromIndex: number, toIndex: number): void;
  clear(): QueueSnapshot;
  updateMeta(meta: NarrationMeta): void;             // keeps addedAt and order
  replaceNarration(storyId: string, voiceProfileId: string | null, meta: NarrationMeta): void;
  removeByVoice(voiceProfileId: string): void;

  startAt(narrationId: string): QueueEntry | null;   // sets currentId
  leaveQueue(): void;                                // currentId = null
  advance(): QueueEntry | null;                      // currentId = next; null at the end (currentId unchanged)
  get current(): QueueEntry | null;
  get index(): number;                               // of currentId, -1 when none
  get next(): QueueEntry | null;
  get previous(): QueueEntry | null;
  get upcoming(): QueueEntry[];                      // after current; [] without context
  get totalMinutes(): number | null;                 // real lengths only; null if any unknown
}
export const queueStore = new QueueStore();
```
- Key = `narrationId`, unique. The same story with another narrator is another entry.
- Every mutation persists the whole snapshot `{ version: 1, entries, currentId }` with one `AsyncStorage.setItem` (no debounce timer). A malformed snapshot reads as empty.
- `remove` of the current entry clears `currentId` (that story keeps playing, nothing follows).

### 6.3 Playback from the queue (`src/stores/queuePlayback.ts`)

```ts
export async function playQueueFrom(narrationId?: string): Promise<boolean>;
  // entry = startAt(narrationId ?? entries[0].narrationId);
  // audio.startNarration({ narrationId: entry.narrationId, meta: entry }, { autoplay: true, fromQueue: true })
export async function playNext(): Promise<boolean>;      // advance() + start
export async function playPrevious(): Promise<boolean>;  // position > 5 s: seek(0); else previous + start
export function bindStoryEnd(audio: AudioPlayerStore, queue: QueueStore,
                             timer: SleepTimerService): () => void;
```
`bindStoryEnd` (called once by `AudioSessionBridge`, 2.8; the store, the queue and the timer are passed in, so `queuePlayback.ts` only reaches the store singleton lazily inside `playQueueFrom` / `playNext` / `playPrevious`) installs:

- `audio.setStartListener((id, options) => { if (!options.fromQueue && queue.currentId !== id) queue.leaveQueue(); })`.
- `audio.setStoryEndHandler(finishedId => ...)`:
1. `timer.handleStoryFinished() === 'stop'`: return 'stop' (the timer turned itself off; the story rests at its end).
2. `queue.currentId === finishedId` and `const next = queue.advance()`: `void audio.startNarration({ narrationId: next.narrationId, meta: next }, { autoplay: true, fromQueue: true })`; return 'advance'.
3. Otherwise, if a stories-mode timer is active: `timer.turnOff()`. Return 'stop'.

It runs synchronously inside the status event, before any React effect, so no screen can consume it, and it works with the player closed and the screen off.

Queue context: set only by `startAt` (via the functions above); cleared by `startNarration` without `fromQueue` for another narration (2.3 step 1), and by removing the current entry.

### 6.4 Where users add

| Place | Interaction | Detail |
|-------|-------------|--------|
| StoryDetail (`StoryDetailScreen.tsx` `options`, 587-601) | "Sıraya ekle" row in `StoryOptionsSheet`, subtitle the narrator ("Kerem anlatıyor") | Shown when a READY narration exists for the selected narrator (`narrationsForVoice.filter(isNarrationReady)`, newest); "Sıradan çıkar" when it is queued. Runs through `afterOptions`. |
| Library Masallarım row (`NarrationRow` / `LibraryRowCard`) | Long press on the row body opens `StoryOptionsSheet` with "Sıraya ekle" / "Sıradan çıkar" and "Masalın sayfası" | `LibraryRowCard` gets `onLongPress` (to its Pressable) and `accessibilityActions={[{ name: 'longpress', label: t('player:queue.add') }]}` + `onAccessibilityAction`. READY rows only. |
| Library count row (`MyLibraryScreen` `countRow`) | Text Button size sm, icon `play`, `t('library:playAll')` ("Hepsini çal") on the right | Shown with 2 or more READY narrations, not while searching. `queueStore.replaceAll(readyMetas.slice(0, QUEUE_MAX))` in list order (loaded pages), `playQueueFrom()`. If the queue was not empty: snackbar `t('player:queue.replaced')` with "Geri al" restoring the snapshot and the previous context. |
| Story cards (Home `CoverCard`, Discover `StoryCard`) | Long press opens `StoryOptionsSheet` with "Sıraya ekle", "Kaydet" / "Kaydedilenlerden çıkar", "Masalın sayfası" | `CoverCard` and `StoryCard` get `onLongPress` (to the cover Pressable; `PictureCover` already supports it). "Sıraya ekle" resolves on press: `storyStore.getNarrationsForStory(id)` READY newest, else `NarrationService.getNarrationsByStory(id)`; none: `showToast.info(t('player:notNarratedYet'), undefined, { label: t('player:openStory'), onPress: openStory })`. |
| Player | Queue button (5.4) | Manage only; the playing story is not offered for adding. |

`StoryOptionsSheet` gets an optional `title` prop (default `detail:more.title` "Masal"); the Library and card menus pass the story title.

Feedback for every add: `added`: `showToast.success(t('player:queue.added'), undefined, { label: t('player:queue.open'), onPress: () => queueSheet.open('toast') })`; `exists`: `showToast.info(t('player:queue.exists'), undefined, same action)`; `full`: `showToast.error(t('player:queue.full', { max: QUEUE_MAX }))`. Adding while the queue plays appends (it will play in order); adding with no context starts nothing.

### 6.5 Queue sheet (`src/components/audio/QueueSheet.tsx`, new)

Host: `src/stores/queueSheet.ts` (`open(origin: 'player' | 'library' | 'toast')`, `close()`, observable `visible`, `origin`) and `src/components/audio/QueueSheetHost.tsx` mounted once in `RootNavigator` after `Stack.Navigator`, inside `NavigationContainer` (uses `navigationRef`). Openers: player queue button, Library app bar button, add snackbars, the timer sheet's "Sırayı aç" (that one closes the timer sheet first and opens the queue after the sheet's `onClosed` from the sheet spec; until that exists, after `SHEET_SWAP_MS`).

Library app bar: `IconButton variant="tactile" icon="queue" badge={n}` before the search button, both segments, a11y `t('player:queue.a11yOpen', { n })`, `queueSheet.open('library')`.

Sizes (scale: `T.space` 4 / 8 / 12 / 16 / 20 / 28 / 40, radii `T.r`, lips `T.lipSize`):
- `BottomSheet` with `title={t('queue.title')}` ("Sıradakiler") and `headerTrailing` = text Button size sm "Düzenle" / "Bitti" (only with 2 or more entries). No other heading.
- Summary row: `minHeight 40`, `paddingHorizontal T.screenPadH`. Left: `text.meta` `T.text2` `t('queue.summary', { n, minutes })` / `summaryOne` / `summaryNoTime` / `summaryOneNoTime` (minutes from real lengths only). Right, when there is no queue context, or the context sits on the last entry that ended: Button size sm variant primary, icon `play`, `t('queue.playAll')` ("Sırayı çal"), calls `playQueueFrom()`.
- List: `ScrollView`, `paddingHorizontal T.screenPadH - T.space.sm` (12) so the row padding (8) puts covers on the 20dp gutter. Rows `minHeight 60`, `gap T.space.xs` between rows (pitch 64), radius `T.r.lg` (20), `paddingHorizontal T.space.sm`.
- Row: leading slot 24 wide (`text.meta` index number in `T.text3`, or the now-playing bars in `T.action` on the current row), gap 8, cover 40 square radius `T.r.sm` (12) with `placeholderIndex` from `useCoverSpread` and the entry's `translationGroupId`, gap 12, text column: title `text.labelLarge` one line `T.text`, meta one line `text.meta` `T.text2` "Kerem anlatıyor, 6 dk" (`library:row.narrator` + real length when known). Title width at 360dp: 236dp normal, 148dp in edit mode.
- Current row (queue context): face `T.surface2` on a `T.lipSize.md` lip (raised), bars animated while `audio.isPlaying` (r14-bars: three `Animated.loop`s, scaleY 0.35 to 1, 520 / 640 / 580 ms, `Easing.bezier(0.4, 0, 0.2, 1)`, native driver, `transformOrigin: 'bottom'`, static under reduce motion; no interval, no setState).
- Sheet height: computed when the sheet opens: header + summary + `min(entries, 6) * 64` + bottom inset, at most 88%. It does not change while open (a removed row leaves room at the bottom; nothing above moves). Requires a fixed `height` on `BottomSheet` (add `height?: number` if the sheet spec does not).
- Normal mode tap: `playQueueFrom(entry.narrationId)`. Origin 'player': the sheet stays open and the player switches in place. Other origins (NL-07): close first; in the commit after it, once the sheet's exit has started, `playQueueFrom` and then `navigate('AudioPlayer', { narrationId, autoplay: true })`, so neither the start nor the player's first render holds the sheet up. The narration is already pending when the player opens, so the screen renders at once and starts nothing twice. A plain close (scrim, back) starts nothing.
- Edit mode ("Düzenle"): every row except the current one gets, at the right, a remove `IconButton` (44 x 44, icon `close`, a11y `t('queue.removeOne', { title })`) and a drag handle (44 x 44, new icon `drag: ['reorder-three-outline', 'reorder-three']`). At the end of the list a text Button in `T.error` "Sırayı temizle" (`queue.clear`).
- Drag: a `PanResponder` on the handle (no new dependency, works inside the RN Modal). Grant: the row lifts (`T.surface2` face, `zIndex`), the `ScrollView` gets `scrollEnabled={false}`, `onPanResponderTerminationRequest` returns false. Move: the row follows the finger (`Animated.Value.setValue`, JS); when the hovered index changes, the rows in between shift by one pitch (`Animated.timing` 150 ms, native driver). Release: `queueStore.move(from, to)` once; reset the translations in a `useLayoutEffect` keyed on the new order so nothing flashes.
- Every row (both modes) has `accessibilityActions` `moveUp`, `moveDown`, `remove` (not on the current row) with the labels of `queue.moveUp` / `queue.moveDown` / `queue.removeOne`.
- Remove: optimistic, snackbar in the sheet `t('queue.removed')` with `{ label: t('common:undo'), onPress: () => queueStore.restore(removed) }`. Clear: same with `t('queue.cleared')` and `restoreSnapshot`. No confirmation dialog (a dialog over a sheet is refused on iOS, r14-4).
- Empty: `StateIcon` icon `queue`, `t('queue.empty.title')` ("Sıran boş"), `t('queue.empty.hint')`, secondary Button `t('queue.empty.action')` ("Kütüphaneye git") that closes the sheet and navigates to `Main` > `Library` (`requestLibrarySegment('mine')`).
- No loading state: the queue is local.

### 6.6 Row metadata

Captured when the entry is added (`metaFromNarration`), refreshed by `updateMeta` whenever that narration is fetched (2.3 step 14) or listed. Lengths always through `resolveNarrationDurationMs(id, estimateMs)` for rows, and real only (`knownNarrationDurationMs`) for the timer and the summary minutes. An expired signed cover URL still shows from the disk cache (`resolveCover` caches on the path without the query) or falls back to the placeholder (`PictureCover` `onError`). No backend item.

### 6.7 Housekeeping

- Regenerate (`replace: true`) READY: `replaceNarration(storyId, voiceProfileId, newMeta)` keeps the entry's place. Voice deleted (`useVoiceProfile.deleteVoiceProfile` success): `removeByVoice(id)`. A narration deleted from the Library (if the Library spec adds delete): `remove(id)` and `clearLastPlayed()` when it points to it.
- A queued start whose narration is gone (stream fails, then `getNarrationById` 404): remove the entry, `showToast.info(t('player:queue.skippedMissing'))`, `playNext()` once.

### 6.8 Tests

- `QueueStore.test.ts`: add / exists / full (50); dedupe by narration id, a second narrator of the same story is a new entry; move, remove + restore at the same index, clear + restoreSnapshot; `advance` follows `currentId` after a reorder; removing the current entry clears the context; `next` null at the end; `upcoming` empty without context; persist and hydrate per user; another user's key is not read; malformed storage reads empty; `replaceNarration` keeps the position.
- `queuePlayback.test.ts`: "advances to the next entry with no screen mounted" (`startNarration` called with `fromQueue: true, autoplay: true`); "a story outside the queue does not advance even if it is queued"; "the end of the queue stops and turns a stories timer off"; "a 2-story timer stops after the second story"; "the advance uses no timer" (fake timers never advanced, the start still happens); "a sample finishing does nothing"; "a missing narration is dropped and the next one starts".
- `QueueSheet.test.tsx`: header and summary ("3 masal, 18 dk"; "1 story" in English); "Sırayı çal" only without context; tap starts from that entry; origin player keeps the sheet open, origin library closes and navigates with autoplay; edit mode shows handles and remove on every row but the current; every control at least 44dp; accessibility actions move a row; remove shows "Geri al" and undo restores the index; clear and undo; empty state button navigates to Library; the bars use `Animated.loop` and `setInterval` is never called; the sheet height does not change after a remove.
- `StoryDetailScreen.test.tsx`: "Sıraya ekle" only with a READY narration for the selected narrator, adds that narration, toast with "Sırayı aç"; "Sıradan çıkar" when queued.
- `MyLibraryScreen.test.tsx`: long press offers "Sıraya ekle" and adds; the row exposes the `longpress` accessibility action; "Hepsini çal" replaces the queue in list order and starts the first; undo restores the previous queue; the app bar queue button shows the count.
- `HomeScreen.test.tsx` / `StoryLibraryScreen.test.tsx`: card long press opens the options sheet; "Sıraya ekle" without a ready narration shows `notNarratedYet` with "Masalın sayfası".

---

## 7. Sleep timer

### 7.1 `src/services/SleepTimerService.ts`

- `attachPlayer(player)` is called once by `AudioSessionBridge` (2.8), no longer by the player screen. `SleepTimerPlayer` gains `readonly currentPositionMs: number` (observable) and `readonly nativePlayer: object | null` (the expo-audio shared object, a getter on the store).
- Default `mode = 'duration'` (a stored mode still wins in `hydrateFromPreferences`).
- Store: add `durationTotalMs: number` (minutes x 60 000 at `startDuration`, plus 5 min per `addMinutes`, capped at 180 min) for the drain line. Service: `get isFading()`: true while a duration timer with fade-out has 60 s or less left (native or JS fade), or while the JS stories-mode fade is applied. `store.play()` leaves the volume alone then.
- Ticker: replace `setInterval` with a self-aligning `setTimeout` (r14-tick-drift): duration mode `delay = ((endsAtMs - Date.now()) % 1000 + 1000) % 1000 + 25`, stories mode 1000. `startDuration` calls `stopTicker()` then `startTicker()` so a restart aligns at once.
- Status-driven fallback: in `attachPlayer`, `this.disposePosition = reaction(() => player.currentPositionMs, () => { if (this.store.active) this.tick(); })`. expo-audio reports every 500 ms while playing, also with the screen off; `tick()` reads the wall clock and is idempotent. Nothing needs stopping while paused.
- Native deadline (Android, 7.2): `syncNativeDeadline()` after `startDuration`, `addMinutes`, `setMode`, `setFadeOut`, `turnOff`: active duration timer, driver present and `player.nativePlayer` set: `driver.arm(nativePlayer, endsAtMs, fadeOut ? SLEEP_TIMER_FADE_SECONDS * 1000 : 0)`; else `driver?.disarm(true)`. While armed, JS `tick()` in duration mode updates `remainingSeconds` only: no `applyFade`, no `expire`, unless `Date.now() > endsAtMs + NATIVE_GRACE_MS (3000)` (then JS expires itself).
- `driver.onFired(e)`: `turnOff()`; `void player.pause()` (the native player is already paused; this syncs the store and saves the position); snackbar `player:timer.finished` now if `AppState.currentState === 'active'`, else once on the next 'active'.
- `onPlayRequested()` (called by `store.play()`): a duration timer whose deadline passed while the app was suspended turns off silently, so the story the user asks for is not paused a second later.
- Stories-mode fade (last minute of the last story) stays in JS, driven by the ticker in the foreground and by the position reaction in the background.

### 7.2 Android: deadline in `modules/sesly-media`

New `modules/sesly-media/android/src/main/java/expo/modules/seslymedia/SeslySleepTimer.kt`:

```kotlin
package expo.modules.seslymedia

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.Player
import java.lang.ref.WeakReference

/**
 * The duration sleep timer, on the main looper next to expo-audio's ExoPlayer.
 * JS timers stop while the activity is paused (screen off), so the deadline
 * and the fade-out live here. Each tick compares the wall clock with the
 * deadline, so time spent in deep sleep (nothing plays then) is caught up on
 * the next wake. At the deadline the player is paused and JS is told.
 */
internal object SeslySleepTimer {
  const val EVENT_FIRED = "onSleepTimerFired"
  private const val TICK_MS = 1_000L
  private const val FADE_TICK_MS = 200L

  private val handler = Handler(Looper.getMainLooper())
  private var target: WeakReference<Player>? = null
  private var endsAtEpochMs = 0L
  private var fadeMs = 0L
  private var volumeTouched = false

  /** Set by the module: delivers an event to JavaScript. */
  @Volatile var eventSink: ((name: String, body: Map<String, Any?>) -> Unit)? = null
  @Volatile var isArmed = false
    private set

  private val tick = Runnable { check() }

  /** Main thread. Arming again (restart, +5 dk) replaces the deadline. */
  fun arm(player: Player, endsAt: Long, fade: Long) {
    handler.removeCallbacksAndMessages(null)
    restoreVolume(player)
    target = WeakReference(player)
    endsAtEpochMs = endsAt
    fadeMs = fade.coerceAtLeast(0L)
    isArmed = true
    check()
  }

  /** Main thread. */
  fun disarm(restore: Boolean) {
    handler.removeCallbacksAndMessages(null)
    if (restore) target?.get()?.let { restoreVolume(it) }
    target = null
    isArmed = false
  }

  private fun check() {
    val player = target?.get() ?: run { disarm(restore = false); return }
    val now = System.currentTimeMillis()
    val left = endsAtEpochMs - now
    if (left <= 0L) {
      val sounding = player.playWhenReady &&
        player.playbackState != Player.STATE_ENDED &&
        player.playbackState != Player.STATE_IDLE
      if (sounding) player.pause()
      // After the pause, so it is inaudible; the next play is not silent.
      // (JS play() also sets the volume back to 1.)
      restoreVolume(player)
      target = null
      isArmed = false
      emit(mapOf("paused" to sounding, "firedAtMs" to now.toDouble()))
      return
    }
    if (fadeMs > 0L && left <= fadeMs) {
      player.volume = (left.toFloat() / fadeMs.toFloat()).coerceIn(0f, 1f)
      volumeTouched = true
    } else {
      restoreVolume(player)
    }
    val delay = if (fadeMs > 0L && left <= fadeMs + TICK_MS) FADE_TICK_MS else minOf(TICK_MS, left)
    handler.postDelayed(tick, delay)
  }

  private fun restoreVolume(player: Player) {
    if (!volumeTouched) return
    player.volume = 1f
    volumeTouched = false
  }

  private fun emit(body: Map<String, Any?>) {
    try {
      eventSink?.invoke(EVENT_FIRED, body)
    } catch (error: Exception) {
      Log.w("SeslyMedia", "Sleep timer event not delivered", error)
    }
  }
}
```

`SeslyMediaModule.kt`:
- `Events(..., SeslySleepTimer.EVENT_FIRED)`.
- `OnCreate`: `SeslySleepTimer.eventSink = events` (the same lambda as the session holder).
- `OnDestroy`: inside the existing main-looper post, `if (SeslySleepTimer.eventSink === mine) { SeslySleepTimer.eventSink = null; SeslySleepTimer.disarm(restore = true) }`.
- Functions:
```kotlin
AsyncFunction("armSleepTimer") { player: SharedRef<*>, endsAtEpochMs: Double, fadeMs: Double ->
  val exoPlayer = player.ref as? Player ?: throw NotAMediaPlayerException()
  SeslySleepTimer.arm(exoPlayer, endsAtEpochMs.toLong(), fadeMs.toLong())
}.runOnQueue(Queues.MAIN)

AsyncFunction("disarmSleepTimer") { restoreVolume: Boolean ->
  SeslySleepTimer.disarm(restoreVolume)
}.runOnQueue(Queues.MAIN)

Function("isSleepTimerArmed") { SeslySleepTimer.isArmed }
```
- It does not depend on the media session being active (free users never get one; they are paused in the background anyway). It touches `ExoPlayer.volume` directly, not expo-audio's `previousVolume`.

`modules/sesly-media/index.ts`:
```ts
export interface SleepTimerFiredEvent {
  /** The player was sounding and has been paused. */
  paused: boolean;
  firedAtMs: number;
}
export interface SeslyMediaEvents {
  onCommand: ...; onBecomingNoisy: ...; onSessionEnded: ...;
  onSleepTimerFired: (event: SleepTimerFiredEvent) => void;
}
export interface SeslyMediaModule {
  ...
  armSleepTimer(player: object, endsAtEpochMs: number, fadeMs: number): Promise<void>;
  disarmSleepTimer(restoreVolume: boolean): Promise<void>;
  isSleepTimerArmed(): boolean;
}
```

New `src/utils/sleepDeadline.ts`:
```ts
export interface SleepDeadline {
  arm(player: object, endsAtEpochMs: number, fadeMs: number): void;
  disarm(restoreVolume: boolean): void;
  onFired(listener: (event: SleepTimerFiredEvent) => void): () => void;
}
/** Android builds that have the native timer; null on iOS, in Jest and on an older binary. */
export function getNativeSleepDeadline(
  module: SeslyMediaModule | null = getAndroidMediaSession(),
): SleepDeadline | null;   // null unless typeof module.armSleepTimer === 'function'
```
Errors from `arm` / `disarm` are caught and logged; the JS fallback stays on.

This is the only native change of the spec: one Android rebuild, no new dependency, no prebuild. A JS bundle on an older binary keeps working through the fallback.

### 7.3 iOS

No native work. RN iOS timers keep firing in the background (`RCTTiming.mm` switches to an NSTimer in `appDidMoveToBackground`; bridgeless uses the same through `RCTTiming`), and the app keeps running while it plays audio (background audio mode, Pro). The aligned ticker plus the status-driven reaction stop and fade the story; `player.volume` works in the background.

### 7.4 Countdown display

Player tile (`TimerTile` in `AudioPlayerScreen.tsx`):
- `sleepTimerEntryLabel` returns `{ label, value }`: off `timer.short` / `timer.off`; duration `timer.remainingLabel` ("Kalan süre") / `formatCountdown(remainingSeconds)`; stories 1 left `timer.short` / `timer.tileThisStory` ("Bu masal"); stories n `timer.short` / `timer.tileStories` ("{{n}} masal", n > 1).
- Value `Text`: `fontVariant: ['tabular-nums']` (Baloo 2 has `tnum`), `numberOfLines={1}`, **no** `adjustsFontSizeToFit` / `minimumFontScale`. Add tabular-nums to `optValue` for the speed tile too.
- The tile always passes `borderColor={tint?.ring ?? 'transparent'}`, `borderWidth 2` (no 2dp shift on, audio-24). Face `paddingHorizontal 12`, `gap 8`, icon square 32 radius `T.r.sm`: the text slot is 86dp at 360dp in both states; "14:52" is 44dp, "180:00" 54dp, "Bu masal" 68dp, "This story" 74dp.
- Drain line while a duration runs: absolute, `left 12`, `right 12`, `bottom 6`, height 3, radius 2, track `withAlpha(T.catUyku, 0.3)`, fill `T.catUyku` through `AnimatedFill`. Driven by a new `sleepDrain` driver (`src/components/audio/sleepDrain.ts`): one `Animated.Value` (remaining fraction), re-anchored on `endsAtMs` / `durationTotalMs` changes, `Animated.timing` toward 0 in chunks of at most 20 s (native driver, linear), stopped in the background and restarted from the wall clock on return. The digits never animate.
- `TimerTile` stays the only per-second observer on the screen.

Timer sheet countdown (7.5): `const Countdown = observer(...)` is the only reader of `remainingSeconds`; Baloo 2 28 / 38 tabular-nums, no auto-fit; the same drain line under it, full width of its row.

`PlayerTimerSheet` passes `remainingSec` rounded up to whole minutes (`Math.ceil(sec / 60) * 60`), and keeps the last value while the sheet closes (r14-3). The stop line keeps its shown time in a ref and only replaces it when the title, the count or the speed changes, or the time moves by 30 s or more (r14-stopline-flip).

### 7.5 Timer sheet layout (`src/components/audio/TimerSheet.tsx`)

```
handle
[ Uyku zamanlayıcısı ......................... (Switch) ]   header (BottomSheet title + headerTrailing)
[ Masal bitince | Süre dolunca ]                            SegmentedControl, marginBottom 12
+------------------------ timer-body, fixed height H ------------------------+
| duration: MinuteWheel (3 rows) / stop line / chips row or countdown row     |
| stories:  stepper row (queue only) / stop line / upcoming or queue hint     |
+-----------------------------------------------------------------------------+
[ Son bir dakikada sesi yavaşça kıs ................ (Switch) ]  SwitchRow
```
- `WHEEL_VISIBLE_ROWS = 3` (export `WHEEL_HEIGHT`). `H = 112 + 16 + Math.ceil(20 * fs) + 46` (wheel 3 x 36 + its 4dp top padding, the stop line, the 46dp slot) with `fs = min(PixelRatio.getFontScale(), 1.3)`: 194dp at 1.0, 200dp at 1.3. Every text in the body has `maxFontSizeMultiplier={1.3}`. The body is a `View` of height `H`, content top-aligned; the sheet's height never changes with the mode, the switch or the running state. Budget check of the stories layouts at 1.3: with a queue 74 (stepper row) + 68 (2-line stop line) + 52 (2-line upcoming) = 194; without 68 + 52 (hint) + 48 (button) = 168.
- Duration, not running: wheel, stop line `t('timer.durationStop', ...)` (one line), chips row: a horizontal `ScrollView` of height 46, always rendered (empty when no chip), gap 8, `paddingHorizontal T.screenPadH`, shorter chip labels (`chipThisStory` "Bu masal ({{n}} dk)", `chipWithNext` "Sıradakiyle ({{n}} dk)", `chipLast` "Son seçim ({{n}} dk)").
- Duration, running: the same wheel (moving it restarts after `WHEEL_REST_MS`), the stop line shows the real deadline (`stopsAt`), and the 46dp slot holds the countdown row instead of the chips: `Countdown` + `t('timer.left')` + "+5 dk" Button size sm; chips and countdown cross-fade (150 ms, native) in the same slot. "Süreyi değiştir" and the separate running body are deleted, with `showWheel`, `wheelKey`, `openWheelAt`.
- Stories mode, in queue context with upcoming entries: stepper row (`paddingVertical 12`, max `1 + upcoming.length`), stop line (`numberOfLines={2}`), then `t('timer.upcoming', { titles })` ("Sırada: Pinokyo, Çizmeli Kedi", up to 2 lines).
- Stories mode otherwise: no stepper; stop line with the playing story's title, e.g. "Pinokyo bitince, 21:51'de durur" (`timer.storyStop` with count 1; `storyStopNoTime` while the length is unknown), `t('timer.queueHint')` (2 lines max), text Button `t('player:queue.open')` ("Sırayı aç") calling the new `onOpenQueue` prop.
- Off: nothing is dimmed or blocked (`pointerEvents`, `opacity 0.38`, `accessibilityElementsHidden` removed). The stop line is `T.text2` while off, `T.text` while on. Every control turns the timer on in its own mode: segment `handleMode(mode)` (`setMode` then `turnOn` when off); stepper `setStoryCount` then `turnOn`; chip `startDuration(chip.minutes)` and scroll the wheel; wheel rest `startDuration(minutes)` whether or not the timer was on (`flushRest`). a11y hint while off `t('timer.offHint')`.
- `SegmentedControl` must not move its labels (no press sink, sliding pill) and `Switch` animates its knob: both owned by the controls/motion spec (r13-segment-sink, r14-switch). If that spec has not landed, the TimerSheet tests below still require "no translateY on a segment label after pressIn".
- Initialise the sheet's local state during render when it opens (r14-wheel-mount a): `draftMin`, `lastUsedMin`; no `wheelKey` remount.
- Mode switch (LR-3): both bodies stay mounted on top of each other inside `timer-body` and cross-fade in `DURATION.fast` on the native driver; the hidden one has opacity 0, `pointerEvents="none"` and is hidden from screen readers. A switch never mounts or unmounts the wheel: it mounts with the sheet when the sheet opens in "Süre dolunca", else hidden once the sheet has come up (or at the switch, if that comes first), and stays until the sheet is gone. Each body has its own stop line (`timer-stop-line-stories`, `timer-stop-line-duration`).
- Spacing: `segments marginTop 2` to 0, `storiesRow paddingVertical 10` to 12, `stopLine paddingTop 10` to 8, chips `paddingTop 2` to 0.

`MinuteWheel.tsx`:
- Stable initial offset (r14-wheel-offset): `const initialOffset = useRef({ x: 0, y: (clamp(value) - min) * WHEEL_ROW_HEIGHT }).current; contentOffset={initialOffset}`.
- Rows animate with the scroll (r14-wheel-steps): `Animated.ScrollView` with `onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true, listener: handleScroll })}`; every row draws its number once in Baloo 2 34 / 46 tabular-nums; row i gets `scale = scrollY.interpolate({ inputRange: [(i-1)*36, i*36, (i+1)*36], outputRange: [0.6, 1, 0.6], extrapolate: 'clamp' })` and opacity `[0.5, 1, 0.5]`; the unit "dk" is one absolute `Text` on the band, not per row. Rows take no `distance` prop, so the memoised `Row` never re-renders during a scroll. Only the rows within `WHEEL_LIVE_ROWS` (8) of the selected minute, plus every row on the way of a scroll started from code, get the interpolation (LR-3: mounting about a thousand native-driven nodes stalled the mode switch); the others are plain texts at the neighbour scale 0.6 and opacity 0.5, which is what the clamped interpolation gives them. A minute change re-renders only the two rows that enter and leave that window.
- Rows: one `Text` each; taps go through one `Pressable` over the wheel mapping `locationY` to a row (r14-wheel-mount c). `valueText` stable (`useCallback` in TimerSheet), `handleWheel` in `useCallback`, `MinuteWheel` in `React.memo`.

### 7.6 Tests

- `SleepTimerService.test.ts`: aligned ticks: with every callback run 15 ms late, `remainingSeconds` drops by exactly 1 over 200 callbacks and each delay is within 25-1025 ms; observable fake player: without advancing fake timers, a position change past the deadline pauses and turns off, with 30 s left sets volume 0.5; `attachPlayer(null)` disposes the reaction; with a fake native driver: `startDuration` arms with `endsAtMs` and 60 000 (fade on) or 0, `addMinutes` re-arms, `turnOff` and `setMode('stories')` disarm with restore; while armed the JS tick neither fades nor expires until 3 s past the deadline; `onFired` turns off, pauses the store, defers the snackbar while in the background; `onPlayRequested` turns off an overdue duration timer silently; a fresh store defaults to 'duration'.
- `sleepDeadline.test.ts`: null without the module, null when `armSleepTimer` is missing, forwards calls and events; errors are swallowed.
- `mediaSession.contract.test.ts` (new, test-22): reads `SeslyMediaSessionHolder.kt`, `SeslySleepTimer.kt`, `SeslyMediaPlayer.kt` and `SeslyMediaModule.kt` as text: every `EVENT_*` value is a key of `SeslyMediaEvents`, every `COMMAND_*` value is in `MediaSessionCommand`, and `armSleepTimer`, `disarmSleepTimer`, `isSleepTimerArmed` are declared as module functions. Plus "without the native module the wrapper is null" (`jest.isolateModules`).
- `TimerSheet.test.tsx`: rewrite "keeps the whole layout in place, dimmed and not interactive", "turning the switch on and off changes no element", "off in the duration mode shows the wheel ..., dimmed", "opens on the countdown, not the wheel", "Süreyi değiştir ...", "the header switch turns the running timer off; the countdown rests, dimmed": `timer-body` height equals `H` in stories (with and without queue), duration off, duration running, and after a stepper tap with a 60-character title; at font scale 1.3 too; the chip slot is a horizontal ScrollView of height 46 even with no chip; running shows `timer-countdown` in that slot and the wheel stays; with the timer off, pressing "Süre dolunca" turns it on in duration mode, the stepper plus turns it on in stories mode, a chip starts that duration; without a queue there is no stepper, the hint and "Sırayı aç" show and call `onOpenQueue`; with two upcoming entries the stepper goes to 3 and the upcoming line names them; a running countdown re-renders only `Countdown` (render-counting mocks of `SegmentedControl` and `MinuteWheel` unchanged over 10 s while the text changed 10 times); `timer-countdown` has tabular-nums and no `adjustsFontSizeToFit`; the stop line does not flip across a minute boundary with `remainingSec` alternating 600 / 599; English chip labels; segment labels carry no translateY after pressIn.
- `MinuteWheel.test.tsx`: `contentOffset` is the same object after a scroll-driven re-render; every row near the band has an interpolated scale and the rows further away are plain texts at 0.6 / 0.5; the live window follows the selected minute and covers a scroll from code until it arrives; exactly one unit text exists and stays mounted after a scroll; a scroll that changes the minute re-renders no row but the two that enter and leave the live window; tapping at `locationY` of the row below selects the next minute; 3 visible rows.
- `AudioPlayerScreen.test.tsx`: `player-timer-state` has tabular-nums and no auto-fit, its style is unchanged after 3 ticks; label "Kalan süre" with "14:52"; "Bu masal" with one story left; `player-timer-entry-face` borderWidth 2 on and off; the drain line exists only for a running duration timer and its timing uses the native driver with at most 20 000 ms.
- `playerMath.test.ts`: `sleepTimerEntryLabel` shape for off, stories 1, stories 3, duration; `upcomingQueue` rewritten over `QueueEntry` (real lengths only).
- Contrast (`theme.test.tsx` or the contrast spec's suite): for every palette the drain fill `T.catUyku` against the tinted tile face is at least 3:1.

Device checks (Android Pro account, then iPhone): "Süre dolunca 2 dk", lock the phone: the story fades over the last minute and stops at the deadline; the snackbar shows on unlock. "+5 dk" then lock: stops 5 min later. Free account: locking pauses; unlocking keeps it paused and shows "Devam et". Queue of three with the screen off: the second and third start by themselves; a "2 masal sonra" timer stops after the second.

---

## 8. Progress bar smoothness (`src/utils/playbackProgress.ts`)

- Chunks (r14-progress-frames): in `apply()`, `const chunkMs = Math.min(leftMs, PROGRESS_CHUNK_MS /* 20000 */)`; `toValue = Math.min(1, (positionMs + chunkMs * rate) / durationMs)`; on `({ finished }) => finished && this.running === animation`: re-anchor from `expectedPositionMs()` (not from the chunk end) and `apply()` again. At most 1 200 frames per start; linear easing keeps the speed constant across chunks.
- `PlaybackProgressSource` gains `isBuffering`; the bound snapshot is `playing: story && isPlaying && !isSeeking && !isBuffering && totalDurationMs > 0`. The knob no longer runs ahead while a stream buffers and never snaps back when audio arrives (audio-8).
- With the real-only length (2.1), nothing animates before the length is known; the track rests at 0 or the resume point.
- Unchanged: one shared value, drift tolerance 400 ms, frozen in the background and restarted from the prediction on return.
- Native end sync (NL-01): when a native animation ends, React Native copies the value the node had at that moment into the JS side (`Animation.__startAnimationIfNative` calls `__onAnimatedValueUpdateReceived`) and re-renders the bound views, and Fabric commits that value over the native one. A chunk the driver stopped for a seek reports the old position after the driver set the target; with nothing animating (the stream buffers after a rewind) the knob sat at the old position for about half a second while the clock read the target. The driver keeps a `segment` of what the native value does (rests at a value, or runs one chunk) and answers that sync with `shownFraction()` instead of the reported value; while a chunk runs that is the native value within a frame. Without the internal method the hook does nothing (a test runs the real end callback through the mocked native module).
- Tests for NL-01 (`playbackProgress.test.ts`): through the mocked `startAnimatingNode`, a late end of the chunk stopped by a 15 s rewind (value at 1:42 of 5:00) leaves the value at the target; one that lands while the next chunk runs takes the running position; a forward skip and a pause; a finished chunk's end lands on the next chunk's start; a new story and the background keep their value. `SeekConfirmation`: a stale report at the old position is refused, one near the target confirms, the bounds are the drift tolerance and the time since the seek at the rate, a report is taken after the window, the window starts when the player answered, a new epoch ends it. `AudioPlayerScreen.test.tsx`: the knob's `translateX` stays at the target after the stopped chunk's late end re-renders it.
- Tests (`playbackProgress.test.ts`, test-24 and new): a 30-minute story from 0 starts a timing of 20 000 ms toward 20 000 / 1 800 000; finishing it at now + 20 010 starts a second chunk from `expectedPositionMs`; a stop (finished false) starts nothing; `isBuffering` true does not animate and holds the position, false starts; unknown length does not animate; seek in flight holds at the target; AppState 'inactive' pauses and 'active' resumes; rate 0 animates at rate 1; bound while AppState is 'background' starts nothing. Update the expectations at lines 69, 102, 123, 129.

---

## 9. Size and spacing summary

| Element | Value |
|---------|-------|
| Player play | 80dp, lip 4 (`T.lipSize.lg`), glyph 34, busy spinner 28 |
| Player skip | 56dp, lip 3, glyph 28; gap 28 (8 with queue) |
| Player prev / next | 40dp wide, `hitSlop` left / right 4 |
| Option tiles | min height 64, padding 12, gap 8, icon 32 (radius 12), border 2 always, value Baloo 2 17 tabular |
| Timer drain line | 3dp, inset 12, bottom 6 |
| Mini player card | min height 60 + lip 3, padding 8, cover 44, toggle 44 on lip 2, 4dp above the nav bar, gutter `T.screenPadH`, fade 40 |
| List inset while docked | 67 + 8 = 75dp |
| Continue card | `LibraryRowCard` (cover 52, radius 22, lip 3), eyebrow `text.meta` 4dp above |
| Queue row | min height 60, pitch 64, row padding 8, list padding `T.screenPadH - 8`, cover 40 (radius 12), leading 24, controls 44 x 44 |
| Queue sheet | title + text button, 40dp summary row, up to 6 rows visible, fixed height while open |
| Timer body | fixed `H` (194dp at font scale 1.0, 200 at 1.3), wheel 3 rows of 36, chip / countdown slot 46 |

---

## 10. Copy (tr / en)

No emoji, em dash, arrows or unicode ellipsis. No `count` variable; singular keys where n can be 1.

`player.json`
| Key | tr | en |
|-----|----|----|
| `queue.title` | Sıradakiler | Up next |
| `queue.summary` | {{n}} masal, {{minutes}} dk | {{n}} stories, {{minutes}} min |
| `queue.summaryOne` | 1 masal, {{minutes}} dk | 1 story, {{minutes}} min |
| `queue.summaryNoTime` | {{n}} masal | {{n}} stories |
| `queue.summaryOneNoTime` | 1 masal | 1 story |
| `queue.playAll` | Sırayı çal | Play the queue |
| `queue.edit` / `queue.done` | Düzenle / Bitti | Edit / Done |
| `queue.position` | Sıra {{index}}/{{total}} | Queue {{index}} of {{total}} |
| `queue.add` | Sıraya ekle | Add to the queue |
| `queue.removeAction` | Sıradan çıkar | Remove from the queue |
| `queue.removeOne` | {{title}} masalını sıradan çıkar | Remove {{title}} from the queue |
| `queue.added` | Sıraya eklendi | Added to the queue |
| `queue.exists` | Zaten sırada | Already in the queue |
| `queue.full` | Sıra dolu, en fazla {{max}} masal | The queue is full, {{max}} stories at most |
| `queue.removed` | Sıradan çıkarıldı | Removed from the queue |
| `queue.cleared` | Sıra temizlendi | Queue cleared |
| `queue.replaced` | Sıra yenilendi | Queue replaced |
| `queue.clear` | Sırayı temizle | Clear the queue |
| `queue.open` | Sırayı aç | Open the queue |
| `queue.a11yOpen` | Sıradakiler, {{n}} masal | Up next, {{n}} stories |
| `queue.moveUp` / `queue.moveDown` | Yukarı taşı / Aşağı taşı | Move up / Move down |
| `queue.drag` | Sürükleyerek taşı | Drag to move |
| `queue.empty.title` | Sıran boş | Your queue is empty |
| `queue.empty.hint` | Masallarım'da bir masala basılı tut ya da masalın sayfasında Sıraya ekle'ye dokun. | Press and hold a story in My stories, or tap Add to the queue on a story page. |
| `queue.empty.action` | Kütüphaneye git | Go to the library |
| `queue.skippedMissing` | Bir masal bulunamadı, sıradakine geçildi. | A story was missing, the next one is playing. |
| `streamFailed` | Masal oynatılamadı. | The story could not be played. |
| `timer.remainingLabel` | Kalan süre | Time left |
| `timer.tileThisStory` | Bu masal | This story |
| `timer.tileStories` | {{n}} masal | {{n}} stories |
| `timer.storiesValueOne` | 1 masal | 1 story |
| `timer.queueHint` | Sıraya masal eklersen kaç masal sonra duracağını seçebilirsin. | Add stories to the queue to choose after how many it stops. |
| `timer.upcoming` | Sırada: {{titles}} | Next: {{titles}} |
| `timer.offHint` | Dokununca zamanlayıcı açılır | Tapping turns the timer on |
| `timer.chipThisStory` | Bu masal ({{n}} dk) | This story ({{n}} min) |
| `timer.chipWithNext` | Sıradakiyle ({{n}} dk) | With next ({{n}} min) |
| `timer.chipLast` | Son seçim ({{n}} dk) | Last time ({{n}} min) |

Delete: `playlist.*`, `skipped`, `timer.changeDuration`, `timer.afterStory`, `timer.afterStories`, `timer.countdownLeft` (once `sleepTimerEntryLabel` uses the new keys).

`library.json`: `continue.eyebrow` Kaldığın yerden devam et / Pick up where you left off; `continue.a11y` Devam et: {{title}} / Resume {{title}}; `playAll` Hepsini çal / Play all.
`common.json`: `undo` Geri al / Undo.
`generation.json`: `listen` Dinle / Listen.
`messages.json`: `player.pausedOnLockTitle` Masal durdu / The story paused; `player.pausedOnLock` Ücretsiz planda ekran kapanınca masal durur. / On the free plan the story pauses when the screen turns off.; `player.resume` Devam et / Resume; `narration.missingId` tr becomes "Seslendirme bulunamadı". Delete `player.backgroundPaid`, `player.backgroundPaidTitle`, `narration.stage.*` (if unused).
`Icon.tsx`: `queue: ['list-outline', 'list']`, `drag: ['reorder-three-outline', 'reorder-three']`.

---

## 11. Implementation order and files

1. **Store core (blockers):** `useAudioPlayer.ts` (2.1-2.5, 2.7), `src/stores/session.ts`, `src/stores/narrationMeta.ts`, `ApiClient.getFreshAccessToken`, `WebSocketService.ts`, `AudioGenerationScreen.tsx`, `useAuth.ts`, the three voice files, `AudioSessionBridge.tsx`, `RootNavigator.tsx` (mount, route param). Tests 2.11.
2. **Mini player + continue card:** `MiniPlayerDock.tsx`, `MiniPlayerBar.tsx`, `MainScaffold.tsx`, `useMiniPlayerInset.ts` + 4 tab screens, `lastPlayed.ts`, `useLastListened.ts`, `ContinueListeningCard.tsx`, `MyLibraryScreen.tsx`. Tests 3.4, 4.5.
3. **Player screen:** `AudioPlayerScreen.tsx`, `rows.tsx` (`IconButton` `badge`, `hitSlop`), `NarrationRow.tsx`, `StoryDetailScreen.tsx` entry. Tests 5.6.
4. **Queue:** delete the playlist files; `QueueStore.ts`, `queuePlayback.ts`, `queueSheet.ts`, `QueueSheet.tsx`, `QueueSheetHost.tsx`, entry points (StoryDetail, Library, cards), `LibraryRowCard.tsx` `onLongPress`, `CoverCard`, `StoryCard`, `Icon.tsx`, `playerMath.ts`. Tests 6.8.
5. **Sleep timer:** `SleepTimerService.ts`, `sleepDeadline.ts`, `modules/sesly-media` (Kotlin + `index.ts`), `TimerSheet.tsx`, `MinuteWheel.tsx`, `sleepDrain.ts`, `AudioPlayerScreen.tsx` tile. Tests 7.6. **Android native rebuild here.**
6. **Progress:** `playbackProgress.ts`. Tests 8.
7. Docs: `CLAUDE.md` (mobile) Shell, Audio Playback (queue is local and store-driven, `didJustFinish` gone), Player; `docs/REDESIGN_DECISION_LOG.md` 4.4 superseded; workspace `CLAUDE.md` sentence "multi-track queueing lives in PlaylistStore and the UI advances via navigation on didJustFinish" becomes "the queue lives in QueueStore and the audio store advances it".

`npx tsc --noEmit` and `npm test` clean after every step; the i18n parity and glyph tests cover section 10.

---

## 12. Out of scope here (owned by other specs)

- `BottomSheet` motion and the Android navigation bar under sheets (R3, r14-1, r3-*): this spec only needs `height?: number` and `onClosed` from it.
- `SegmentedControl` / `Switch` internals and the motion tokens (r13-segment-sink, r14-switch, r14-system): this spec only states what the timer sheet needs.
- The global button, spacing and gutter scale (R4, R6): this spec uses `T.space`, `T.lipSize`, `T.screenPadH` symbolically and lists the audio-specific dp targets.
- Generation screen visuals (audio-19 animated bar, audio-25 cover seed, audio-26 slow state) and story detail CTA wording (ux-8), Home hero play (ux-25), in-app "Masalın hazır" action (ux-21): they pass `autoplay: true` per 5.2 when they land.
- Palette contrast of surfaces and glass buttons (R5): the queue's current row relies on `T.surface2` differing from `T.surface`, which the contrast spec guarantees.

No backend change is required by this spec.
