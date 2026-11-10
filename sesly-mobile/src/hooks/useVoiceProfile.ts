/**
 * Voice Profile Hook with MobX Store
 *
 * Owns the voice profile list, slot info (preset vs clone), the cached clone
 * config of the chosen voice language (GET /voice-profiles/clone-config) and
 * the ONE training status
 * tracker for cloned voices:
 *   - socket `voice_status` events (via WebSocketService listener)
 *   - a single 5 s poll of GET /voice-profiles/:id/status for tracked ids
 *   - 20 min cap per tracked id, stops on READY / FAILED
 * Screens (ProcessingScreen, VoiceProfilesScreen, ...) only observe this store.
 *
 * The list load is single-flight and `hasLoadedProfiles` tells "not loaded
 * yet" from "no voices"; creating and deleting run under `isMutating`, so a
 * mutation never turns a screen back into its loading shape. Sign-out resets
 * the store (session end handler).
 */

import {makeAutoObservable, runInAction} from 'mobx';
import {useMemo} from 'react';
import VoiceProfileService from '../services/VoiceProfileService';
import WebSocketService, {VoiceStatusEvent} from '../services/WebSocketService';
import {getErrorMessage, hasApiStatus} from '../services/ApiError';
import {
  VoiceProfile,
  isVoiceProfileReady,
  AvailableVoicesResponse,
  AvailableGoogleVoice,
  VoiceSlotInfo,
  CreateVoiceProfileRequest,
  VoiceKindSlotInfo,
  canCreateCloneFromSlots,
  canCreatePresetFromSlots,
  cloneCreationsOf,
  isCloneProfile,
  isCloneCreationLimitReached,
  languageCodeOf,
  DEFAULT_VOICE_LANGUAGE,
} from '../models/VoiceProfile';
import {
  CloneConfig,
  CloneConfigError,
  describeCreationLimit,
  offersMoreCloneSlots,
  offersMorePresetSlots,
} from '../models/VoiceClone';
import type {PlanId} from '../models/Plans';
import {VoiceProfileStatus} from '../types/enums';
import {VOICE_CLONING} from '../config/constants';
import {showToast} from '../utils/toast';
import {registerSessionEndHandler} from '../stores/session';
import {queueStore} from '../stores/QueueStore';
import { msg } from '../i18n/messages';
import { serverTextInUiLanguage } from '../i18n/serverText';

// ============================================================================
// Slot block copy (pure, exported for tests)
// ============================================================================

export type VoiceSlotKind = 'clone' | 'preset';

export interface SlotBlockInfo {
  readonly title: string;
  readonly message: string;
  /** Offer the plans: a higher plan lifts this limit. Otherwise only a delete helps. */
  readonly showPaywall: boolean;
}

function usageSuffix(used: number, limit: number): string {
  return limit > 0 ? ` (${used}/${limit})` : '';
}


/**
 * Why a new voice of `kind` cannot be created, from GET /voice-profiles/slots.
 *
 * A used-up own-voice creation allowance gets the quota copy (lifetime on
 * Free: it never renews; monthly with its renewal date otherwise). Full
 * places get the plan's copy: the free plan's text only on Free, and the
 * plans are offered when a higher plan has more places (own voices: Free and
 * Mini; narrators: Free only, Mini and Premium both have 10).
 *
 * @param planId the user's plan (`SubscriptionStore.planId`).
 */
export function describeSlotBlock(
  info: VoiceSlotInfo | null,
  kind: VoiceSlotKind,
  planId: PlanId,
): SlotBlockInfo {
  if (kind === 'clone') {
    const clone = info?.clone ?? null;
    const creations = cloneCreationsOf(clone);
    if (creations && isCloneCreationLimitReached(clone)) {
      const copy = describeCreationLimit({
        planId,
        limit: creations.limit,
        period: creations.period,
        renewsAt: creations.renewsAt,
      });
      return { title: copy.title, message: copy.message, showPaywall: copy.offerPlans };
    }
    const used = clone?.used ?? info?.used ?? 0;
    const limit = clone?.limit ?? info?.limit ?? 0;
    const serverMessage = clone ? clone.message : info?.message ?? null;
    const key =
      planId === 'free'
        ? 'voice.cloneLimitMessageFree'
        : planId === 'mini'
          ? 'voice.cloneLimitMessageMini'
          : 'voice.cloneLimitMessagePro';
    return {
      title: msg('voice.cloneLimitTitle'),
      message: serverTextInUiLanguage(serverMessage) ?? msg(key, { usage: usageSuffix(used, limit) }),
      showPaywall: offersMoreCloneSlots(planId),
    };
  }

  const preset = info?.preset ?? null;
  const used = preset?.used ?? info?.used ?? 0;
  const limit = preset?.limit ?? info?.limit ?? 0;
  const serverMessage = preset ? preset.message : info?.message ?? null;
  const showPaywall = offersMorePresetSlots(planId);
  return {
    title: msg('voice.presetLimitTitle'),
    message:
      serverTextInUiLanguage(serverMessage) ??
      msg(showPaywall ? 'voice.presetLimitMessageFree' : 'voice.presetLimitMessagePro', {
        usage: usageSuffix(used, limit),
      }),
    showPaywall,
  };
}

// ============================================================================
// Training tracker types
// ============================================================================

export type TrackPhase = 'waiting' | 'ready' | 'failed' | 'timeout';

export interface TrackState {
  readonly phase: TrackPhase;
  readonly errorMessage: string | null;
}

const defaultTrainingFailedMessage = (): string => msg('voice.trainingFailed');

// ============================================================================
// Voice Profile Store (MobX)
// ============================================================================

/**
 * Drop the narrations of a deleted voice from the local queue (SPEC-audio
 * 6.7). A failing queue never turns a successful delete into a failure.
 */
function removeVoiceFromQueue(profileId: string): void {
  try {
    queueStore.removeByVoice(profileId);
  } catch (error) {
    console.warn('Could not drop the deleted voice from the queue:', error);
  }
}

/** "tr-TR", "TR" and "tr" are one catalogue: "tr". '' when no language is given. */
function catalogueKey(language: string | null | undefined): string {
  return (language ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

class VoiceProfileStore {
  // Voice profiles
  voiceProfiles: VoiceProfile[] = [];
  currentProfile: VoiceProfile | null = null;
  /** A list load is running. Creating and deleting use `isMutating`. */
  isLoading = false;
  /**
   * The first list load settled (with or without success). Until then an
   * empty list means "not known yet", not "no voices", so screens show
   * their loading shape. False again after sign-out.
   */
  hasLoadedProfiles = false;
  /** A create or delete is running. */
  isMutating = false;
  errorMessage = '';

  // Available voices: the last response, and the ready-made narrators by
  // the content language they were asked for ('' = no language given).
  availableVoices: AvailableVoicesResponse | null = null;
  narratorCatalogue = new Map<string, readonly AvailableGoogleVoice[]>();
  /** Why the catalogue of a language failed to load; cleared when it is asked again. */
  catalogueErrors = new Map<string, string>();
  isLoadingVoices = false;

  // Voice slots
  voiceSlotInfo: VoiceSlotInfo | null = null;
  isLoadingSlots = false;
  /**
   * Ready-made narrators (voice ids) whose create is on its way. Rows show
   * them as added and `presetSlots` counts them from the tap on, so the
   * screen never waits for the backend to say what the user just did.
   */
  addingPresetIds = new Set<string>();
  /** Profiles whose delete is on its way: `presetSlots` no longer counts them. */
  removingProfileIds = new Set<string>();
  /**
   * Ready-made adds (+1) and removals (-1) that went through, numbered by
   * `presetChangeSeq`; a slot answer asked for after one drops it (it counts
   * it itself).
   */
  presetChanges: Array<{readonly seq: number; readonly delta: number}> = [];

  // Clone config (GET /voice-profiles/clone-config?language=)
  cloneConfig: CloneConfig | null = null;
  isLoadingCloneConfig = false;
  cloneConfigError: string | null = null;
  /**
   * The voice language the clone flow asks its texts in ("en"); null follows
   * the backend default (Turkish). After a load it is the language the
   * backend answered in.
   */
  cloneLanguage: string | null = null;

  // Training tracker (observable results per profile id)
  trackStates = new Map<string, TrackState>();
  /** Profile id a screen is currently showing progress for (no toast then). */
  trackingObservedId: string | null = null;

  // Tracker internals (not observable)
  private trackedSince = new Map<string, number>();
  private trackTimer: ReturnType<typeof setInterval> | null = null;
  private trackTickInFlight = false;
  /** Counts clone config requests: only the answer to the last one is kept. */
  private cloneConfigRequest = 0;
  /** The list load in flight; every caller shares it (one request, one toast). */
  private loadPromise: Promise<void> | null = null;
  /** One more load queued behind `loadPromise` by a `fresh` caller. */
  private freshLoadPromise: Promise<void> | null = null;
  /**
   * The catalogue requests in flight, by language key. A caller that asks
   * while one runs shares it (the story page prefetches the catalogue and
   * the narrator sheet asks again when it opens). Resolves to true when the
   * catalogue was stored.
   */
  private catalogueRequests = new Map<string, Promise<boolean>>();
  /** Bumped by `reset()`: an answer for the previous session is dropped. */
  private session = 0;
  /**
   * PENDING clones whose discard failed (offline). Deleted after the next
   * successful list load while they are still PENDING, so an orphaned
   * placeholder does not hold the clone slot.
   */
  private pendingDiscardIds = new Set<string>();
  private sweepingDiscards = false;
  /** Numbers `presetChanges`. */
  private presetChangeSeq = 0;

  constructor() {
    makeAutoObservable<
      this,
      | 'trackedSince'
      | 'trackTimer'
      | 'trackTickInFlight'
      | 'cloneConfigRequest'
      | 'loadPromise'
      | 'freshLoadPromise'
      | 'catalogueRequests'
      | 'session'
      | 'pendingDiscardIds'
      | 'sweepingDiscards'
      | 'presetChangeSeq'
    >(this, {
      trackedSince: false,
      trackTimer: false,
      trackTickInFlight: false,
      cloneConfigRequest: false,
      loadPromise: false,
      freshLoadPromise: false,
      catalogueRequests: false,
      session: false,
      pendingDiscardIds: false,
      sweepingDiscards: false,
      presetChangeSeq: false,
    });
    void this.loadVoiceProfiles();
  }

  // ============================================================================
  // Computed Getters
  // ============================================================================

  get readyProfiles(): VoiceProfile[] {
    return this.voiceProfiles.filter(p => isVoiceProfileReady(p));
  }

  /** clone.canCreate + the creation allowance (falls back to shared canCreate). */
  get canCreateClone(): boolean {
    return canCreateCloneFromSlots(this.voiceSlotInfo);
  }

  /**
   * The ready-made places as the screen shows them: the last
   * `GET /voice-profiles/slots`, plus what changed since that answer was
   * asked for (adds and removals that went through) and what is still on
   * its way (an add counts from the tap, a removal from the confirm). So
   * the "Listende 2/3" line moves in the same frame as the row. The next
   * slot answer that was asked after a change replaces it. Null while the
   * slots are not known.
   */
  get presetSlots(): VoiceKindSlotInfo | null {
    const preset = this.voiceSlotInfo?.preset ?? null;
    if (!preset) return null;
    let used = preset.used;
    for (const change of this.presetChanges) used += change.delta;
    const listedPreset = (voiceId: string) =>
      this.voiceProfiles.some(p => p.voiceId === voiceId && !isCloneProfile(p));
    this.addingPresetIds.forEach(voiceId => {
      if (!listedPreset(voiceId)) used += 1;
    });
    this.removingProfileIds.forEach(id => {
      const removing = this.voiceProfiles.find(p => p.id === id);
      if (removing && !isCloneProfile(removing)) used -= 1;
    });
    used = Math.max(0, used);
    if (used === preset.used) return preset;
    return {
      ...preset,
      used,
      canCreate: preset.limit > 0 ? used < preset.limit : preset.canCreate,
    };
  }

  /** The slot snapshot with the ready-made places of `presetSlots`. */
  get effectiveSlotInfo(): VoiceSlotInfo | null {
    const info = this.voiceSlotInfo;
    const preset = this.presetSlots;
    if (!info || !preset || preset === info.preset) return info;
    return {...info, preset};
  }

  /** preset.canCreate (falls back to shared canCreate), with the local adds and removals. */
  get canCreatePreset(): boolean {
    return canCreatePresetFromSlots(this.effectiveSlotInfo);
  }

  /**
   * A ready-made narrator may be added without asking the backend first:
   * the slots and the list are known and show a free place (counting the
   * adds on their way). The backend still enforces PRESET_SLOT_LIMIT.
   */
  get canAddPresetNow(): boolean {
    return this.voiceSlotInfo !== null && this.hasLoadedProfiles && this.canCreatePreset;
  }

  /** A ready-made narrator's add is on its way (its row already shows it as added). */
  isAddingPreset(voiceId: string): boolean {
    return this.addingPresetIds.has(voiceId);
  }

  /** See `describeSlotBlock`. */
  slotBlock(kind: VoiceSlotKind, planId: PlanId): SlotBlockInfo {
    return describeSlotBlock(this.effectiveSlotInfo, kind, planId);
  }

  /**
   * Fresh slot check right before an "add voice" action. Returns true when
   * the backend allows it (or slots could not be loaded; the backend still
   * enforces). Callers show `slotBlock()` when this returns false.
   */
  async checkCanCreate(kind: VoiceSlotKind): Promise<boolean> {
    await this.loadVoiceSlots();
    return kind === 'clone' ? this.canCreateClone : this.canCreatePreset;
  }

  getTrackState(profileId: string | null | undefined): TrackState | null {
    if (!profileId) return null;
    return this.trackStates.get(profileId) ?? null;
  }

  // ============================================================================
  // Realtime (WebSocket voice_status)
  // ============================================================================

  applyRealtimeVoiceStatus(event: VoiceStatusEvent): void {
    const {voiceProfileId, status, errorMessage} = event;
    if (!voiceProfileId) return;

    const known = this.patchProfile(voiceProfileId, status, errorMessage ?? null);
    const isFinal =
      status === VoiceProfileStatus.READY || status === VoiceProfileStatus.FAILED;

    if (this.trackedSince.has(voiceProfileId)) {
      if (isFinal) {
        this.resolveTracked(voiceProfileId, status, errorMessage ?? null);
      }
    } else if (status === VoiceProfileStatus.PROCESSING) {
      this.trackVoiceProfile(voiceProfileId);
    } else if (isFinal) {
      // A FAILED clone may have released a slot (or a READY one used it).
      this.loadVoiceSlots();
    }

    if (!known) {
      // Not in our list yet (created on another screen). Reload so the new
      // status shows up instead of a stale "processing" row; a load already
      // running may have been asked before the profile existed.
      void this.loadVoiceProfiles({fresh: true});
    }
  }

  // ============================================================================
  // Voice Profiles CRUD
  // ============================================================================

  /**
   * Load the user's voices. Single-flight: a call while a load is running
   * gets that load's promise, so a screen mount, a focus effect and a socket
   * event at once make one request (and at most one error snackbar).
   *
   * @param options.fresh the caller changed something on the backend (an
   *   upload, a delete) or heard of a voice the list does not have: a load
   *   already running may have been asked before that, so one more load
   *   follows it (shared by every fresh caller meanwhile).
   */
  loadVoiceProfiles(options: {fresh?: boolean} = {}): Promise<void> {
    if (this.loadPromise) {
      if (!options.fresh) return this.loadPromise;
      if (!this.freshLoadPromise) {
        const session = this.session;
        const follow: Promise<void> = this.loadPromise.then(() => {
          if (this.freshLoadPromise === follow) this.freshLoadPromise = null;
          // Any load started from here on was asked after the change.
          return session === this.session ? this.loadVoiceProfiles() : undefined;
        });
        this.freshLoadPromise = follow;
      }
      return this.freshLoadPromise;
    }
    const load = this.doLoadVoiceProfiles().finally(() => {
      if (this.loadPromise === load) this.loadPromise = null;
    });
    this.loadPromise = load;
    return load;
  }

  private async doLoadVoiceProfiles(): Promise<void> {
    const session = this.session;
    try {
      runInAction(() => {
        this.isLoading = true;
        this.errorMessage = '';
      });

      const profiles = await VoiceProfileService.getMyVoiceProfiles();
      if (session !== this.session) return;

      runInAction(() => {
        this.voiceProfiles = profiles;
        const current = this.currentProfile;
        if (current) {
          this.currentProfile = profiles.find(p => p.id === current.id) ?? null;
        }
      });

      this.syncTrackingWithList();
      void this.sweepPendingDiscards();
    } catch (error) {
      if (session !== this.session) return;
      console.error('Load voice profiles error:', error);
      runInAction(() => {
        this.errorMessage = msg('voice.listFailed');
      });
      showToast.error(msg('voice.listFailed'));
    } finally {
      if (session === this.session) {
        runInAction(() => {
          this.isLoading = false;
          // Settled, success or not: an empty list now means "no voices".
          this.hasLoadedProfiles = true;
        });
      }
    }
  }

  // ============================================================================
  // Orphaned PENDING clones
  // ============================================================================

  /**
   * A PENDING clone could not be deleted after its upload failed (offline).
   * It is deleted after the next successful list load if it is still
   * PENDING then, unless `unmarkPendingDiscard` claimed it for a retry.
   */
  markPendingDiscard(profileId: string): void {
    if (profileId) this.pendingDiscardIds.add(profileId);
  }

  /** The recording flow re-uploads to this PENDING clone: keep it. */
  unmarkPendingDiscard(profileId: string): void {
    this.pendingDiscardIds.delete(profileId);
  }

  private async sweepPendingDiscards(): Promise<void> {
    if (this.sweepingDiscards || this.pendingDiscardIds.size === 0) return;
    this.sweepingDiscards = true;
    const session = this.session;
    let deleted = false;
    try {
      for (const id of Array.from(this.pendingDiscardIds)) {
        // Signed out meanwhile, or claimed back for a retry upload.
        if (session !== this.session) return;
        if (!this.pendingDiscardIds.has(id)) continue;
        const listed = this.voiceProfiles.find(p => p.id === id);
        if (!listed || listed.status !== VoiceProfileStatus.PENDING) {
          // Gone, or the sample did arrive after all: nothing to clean up.
          this.pendingDiscardIds.delete(id);
          continue;
        }
        try {
          await VoiceProfileService.deleteVoiceProfile(id);
          this.pendingDiscardIds.delete(id);
          deleted = true;
          runInAction(() => {
            this.voiceProfiles = this.voiceProfiles.filter(p => p.id !== id);
            if (this.currentProfile?.id === id) this.currentProfile = null;
          });
        } catch (error) {
          // Still offline: try again after the next load.
          console.warn(`Could not discard PENDING voice profile ${id}:`, error);
        }
      }
    } finally {
      this.sweepingDiscards = false;
    }
    if (deleted) void this.loadVoiceSlots();
  }

  /**
   * The ready-made narrators that were loaded for a content language
   * ("tr"), in catalogue order; null while that language was never loaded.
   */
  catalogueFor(language: string | null | undefined): readonly AvailableGoogleVoice[] | null {
    return this.narratorCatalogue.get(catalogueKey(language)) ?? null;
  }

  /**
   * Why the narrators of a content language could not be loaded; null while
   * they load, after a success, or before they were asked for. A screen shows
   * its error state with a retry while this is set and nothing was loaded.
   */
  catalogueErrorFor(language: string | null | undefined): string | null {
    return this.catalogueErrors.get(catalogueKey(language)) ?? null;
  }

  /**
   * Load the ready-made narrators of a content language (the story's in the
   * narrator sheet, "Masal dili" on the Sesim tab).
   *
   * The language is sent as `?language=`. A backend that does not know the
   * parameter yet answers with its whole list, so the answer is filtered by
   * language here as well.
   *
   * One request per language at a time: a caller that asks while that
   * language loads waits for the same request. `isLoadingVoices` and the
   * cleared error are set before this returns, so a screen that asks in a
   * tap draws its loading shape in the same frame.
   *
   * @param options.quiet no snackbar when it fails (the narrator sheet still
   *   works with the narrators the user already has).
   */
  async loadAvailableVoices(
    language?: string | null,
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    const key = catalogueKey(language);
    let request = this.catalogueRequests.get(key);
    if (!request) {
      request = this.requestCatalogue(key);
      this.catalogueRequests.set(key, request);
    }
    const stored = await request;
    if (!stored && !options.quiet) showToast.error(msg('voice.catalogueFailed'));
  }

  private async requestCatalogue(key: string): Promise<boolean> {
    try {
      runInAction(() => {
        this.isLoadingVoices = true;
        // A retry shows the loading shape again, not the old error.
        this.catalogueErrors.delete(key);
      });

      const voices = await VoiceProfileService.getAvailableVoices(key || undefined);
      const google = key
        ? voices.google.filter(voice => voice.contentLanguage === key)
        : voices.google;

      runInAction(() => {
        this.availableVoices = { ...voices, google };
        this.narratorCatalogue.set(key, google);
        this.catalogueErrors.delete(key);
      });
      return true;
    } catch (error) {
      console.error('Load available voices error:', error);
      runInAction(() => {
        this.catalogueErrors.set(key, msg('voice.catalogueFailed'));
      });
      return false;
    } finally {
      runInAction(() => {
        this.catalogueRequests.delete(key);
        // Another language may still be on its way.
        this.isLoadingVoices = this.catalogueRequests.size > 0;
      });
    }
  }

  async loadVoiceSlots(): Promise<void> {
    const session = this.session;
    // Changes made before this request are in its answer.
    const askedAfter = this.presetChangeSeq;
    try {
      runInAction(() => {
        this.isLoadingSlots = true;
      });
      const slotInfo = await VoiceProfileService.getVoiceSlots();
      if (session !== this.session) return;

      runInAction(() => {
        this.voiceSlotInfo = slotInfo;
        if (this.presetChanges.length > 0) {
          this.presetChanges = this.presetChanges.filter(change => change.seq > askedAfter);
        }
      });
    } catch (error) {
      // Keep the previous snapshot; the backend still enforces the limit.
      console.error('Load voice slots error:', error);
    } finally {
      runInAction(() => {
        this.isLoadingSlots = false;
      });
    }
  }

  /**
   * The loaded clone config when it is written in `language` (any language
   * when none is given), else null. The consent and recording steps read the
   * config through this, so a text of another language is never shown for
   * the language the user chose.
   */
  cloneConfigFor(language: string | null | undefined): CloneConfig | null {
    const config = this.cloneConfig;
    if (!config) return null;
    const wanted = languageCodeOf(language);
    return !wanted || config.language === wanted ? config : null;
  }

  /**
   * Fetch the clone config (durations, script, intro steps, tips, consent)
   * in a voice language. Without an argument the language of the running
   * flow is kept (a retry, a refetch after CONSENT_REQUIRED).
   *
   * Keeps the previous config on failure; `cloneConfigError` is set so the
   * flow can show an error state with retry when there is no usable config.
   * When several requests overlap (the user switches the language twice)
   * only the last one is applied.
   */
  async loadCloneConfig(language?: string | null): Promise<CloneConfig | null> {
    const wanted =
      language === undefined ? this.cloneLanguage : languageCodeOf(language) || null;
    const request = ++this.cloneConfigRequest;
    runInAction(() => {
      this.isLoadingCloneConfig = true;
      this.cloneConfigError = null;
      this.cloneLanguage = wanted;
    });
    try {
      const config = await this.fetchCloneConfig(wanted);
      if (request !== this.cloneConfigRequest) return null;
      runInAction(() => {
        this.cloneConfig = config;
        this.cloneLanguage = config.language;
      });
      return config;
    } catch (error) {
      if (request !== this.cloneConfigRequest) return null;
      console.error('Load clone config error:', error);
      const message =
        error instanceof CloneConfigError
          ? msg('voice.consentFailed')
          : getErrorMessage(error, msg('voice.configFailed'));
      runInAction(() => {
        this.cloneConfigError = message;
        // The texts on screen are still the previous language's.
        this.cloneLanguage = this.cloneConfig?.language ?? wanted;
      });
      return null;
    } finally {
      if (request === this.cloneConfigRequest) {
        runInAction(() => {
          this.isLoadingCloneConfig = false;
        });
      }
    }
  }

  /**
   * Turkish is the backend's answer without a parameter, so it is asked for
   * that way (which every backend version understands). Another language is
   * sent as `?language=`; a 400 (the language is not offered, or a backend
   * that does not know the parameter) falls back to the default texts, and
   * the caller sees the language it got in `config.language`.
   */
  private async fetchCloneConfig(wanted: string | null): Promise<CloneConfig> {
    if (!wanted || wanted === DEFAULT_VOICE_LANGUAGE) {
      return VoiceProfileService.getCloneConfig();
    }
    try {
      return await VoiceProfileService.getCloneConfig(wanted);
    } catch (error) {
      if (!hasApiStatus(error, 400)) throw error;
      return VoiceProfileService.getCloneConfig();
    }
  }

  /**
   * Refetch after the backend refused an upload with CONSENT_REQUIRED. If the
   * refetch fails the cached (outdated) consent is dropped, so the consent
   * step shows its error state with retry instead of stale text.
   */
  async refreshCloneConfigForReconsent(): Promise<CloneConfig | null> {
    const fresh = await this.loadCloneConfig();
    if (!fresh) {
      runInAction(() => {
        this.cloneConfig = null;
      });
    }
    return fresh;
  }

  /**
   * Create a ready-made (preset) voice profile. Slot pre-checks are done by
   * the calling screen; a backend refusal comes back as `error` so the screen
   * can map codes like PRESET_SLOT_LIMIT to the right dialog.
   */
  async createVoiceProfile(
    request: CreateVoiceProfileRequest,
  ): Promise<{profile: VoiceProfile | null; error: unknown}> {
    if (!request.name || request.name.trim().length < 2) {
      showToast.error(msg('voice.nameTooShort'));
      return {profile: null, error: null};
    }

    if (request.name.length > 50) {
      showToast.error(msg('voice.nameTooLong'));
      return {profile: null, error: null};
    }

    const session = this.session;
    // A ready-made narrator shows as added (and counted) from this frame on.
    const optimisticId = isCloneProfile(request) ? null : request.voiceId;
    try {
      runInAction(() => {
        this.isMutating = true;
        this.errorMessage = '';
        if (optimisticId) this.addingPresetIds.add(optimisticId);
      });

      const profile = await VoiceProfileService.createVoiceProfile(request);
      // Signed out meanwhile: the next account's list never gets it.
      if (session !== this.session) return {profile: null, error: null};

      runInAction(() => {
        // The real row replaces the optimistic one in the same frame.
        this.voiceProfiles.push(profile);
        this.currentProfile = profile;
        if (optimisticId) {
          this.addingPresetIds.delete(optimisticId);
          this.presetChanges.push({seq: ++this.presetChangeSeq, delta: 1});
        }
      });

      if (profile.status === VoiceProfileStatus.PROCESSING) {
        this.trackVoiceProfile(profile.id);
      }
      this.loadVoiceSlots();

      return {profile, error: null};
    } catch (error) {
      console.error('Create voice profile error:', error);
      runInAction(() => {
        this.errorMessage = getErrorMessage(error, msg('voice.createFailed'));
      });
      this.loadVoiceSlots();
      return {profile: null, error};
    } finally {
      runInAction(() => {
        this.isMutating = false;
        // Refused or failed: the row and the count roll back.
        if (optimisticId && session === this.session) this.addingPresetIds.delete(optimisticId);
      });
    }
  }

  async getVoiceSample(profileId: string): Promise<string | null> {
    try {
      const sample = await VoiceProfileService.getVoiceSample(profileId);
      return sample?.audioUrl ?? null;
    } catch (error) {
      console.error('Get voice sample error:', error);
      showToast.error(msg('voice.sampleFailed'));
      return null;
    }
  }

  /**
   * Delete a voice. Resolves true when it is gone (also when the backend no
   * longer had it: a 404, e.g. an orphaned PENDING clone swept meanwhile);
   * false when the backend refused or could not be reached (the reason has
   * been shown and the list is unchanged), so a screen that hid the row puts
   * it back.
   */
  async deleteVoiceProfile(profileId: string): Promise<boolean> {
    const session = this.session;
    try {
      runInAction(() => {
        this.isMutating = true;
        // The count drops in the frame the row goes, not after the backend.
        this.removingProfileIds.add(profileId);
      });

      await VoiceProfileService.deleteVoiceProfile(profileId);
      this.forgetDeletedProfile(profileId);
      return true;
    } catch (error) {
      if (hasApiStatus(error, 404)) {
        this.forgetDeletedProfile(profileId);
        return true;
      }
      console.error('Delete voice profile error:', error);
      showToast.error(getErrorMessage(error, msg('voice.deleteFailed')));
      return false;
    } finally {
      runInAction(() => {
        this.isMutating = false;
        if (session === this.session) this.removingProfileIds.delete(profileId);
      });
    }
  }

  /** The voice is gone on the backend: drop it here, from tracking and from the queue. */
  private forgetDeletedProfile(profileId: string): void {
    runInAction(() => {
      // Counted as gone from here on (in the same frame as the row).
      const gone = this.voiceProfiles.find(p => p.id === profileId);
      if (gone && !isCloneProfile(gone)) {
        this.presetChanges.push({seq: ++this.presetChangeSeq, delta: -1});
      }
      this.removingProfileIds.delete(profileId);
      this.voiceProfiles = this.voiceProfiles.filter(p => p.id !== profileId);

      if (this.currentProfile?.id === profileId) {
        this.currentProfile = null;
      }
    });
    this.stopTracking(profileId);
    this.pendingDiscardIds.delete(profileId);
    // Its narrations can no longer play: drop them from the local queue.
    removeVoiceFromQueue(profileId);
    // Deleting frees a slot.
    void this.loadVoiceSlots();
  }

  // ============================================================================
  // Profile Selection
  // ============================================================================

  setCurrentProfile(profile: VoiceProfile): void {
    this.currentProfile = profile;
  }

  clearCurrentProfile(): void {
    this.currentProfile = null;
  }

  // ============================================================================
  // Training status tracker (single poll loop + socket)
  // ============================================================================

  /**
   * Start (or keep) following a profile until READY / FAILED / 20 min cap.
   * Idempotent: an already-tracked id keeps its original start time.
   */
  trackVoiceProfile(profileId: string): void {
    if (!profileId) return;
    if (!this.trackedSince.has(profileId)) {
      this.trackedSince.set(profileId, Date.now());
    }
    this.trackStates.set(profileId, {phase: 'waiting', errorMessage: null});
    this.ensureTrackTimer();
    void this.trackTick();
  }

  /** Restart the 20 min window (user tapped "Tekrar kontrol et"). */
  restartTracking(profileId: string): void {
    this.trackedSince.delete(profileId);
    this.trackVoiceProfile(profileId);
  }

  stopTracking(profileId: string): void {
    this.trackedSince.delete(profileId);
    this.trackStates.delete(profileId);
    this.stopTrackTimerIfIdle();
  }

  /** A screen showing progress for `profileId` suppresses completion toasts. */
  setTrackingObserved(profileId: string | null): void {
    this.trackingObservedId = profileId;
  }

  private ensureTrackTimer(): void {
    if (this.trackTimer) return;
    this.trackTimer = setInterval(() => {
      void this.trackTick();
    }, VOICE_CLONING.STATUS_POLL_INTERVAL_MS);
  }

  private stopTrackTimerIfIdle(): void {
    if (this.trackedSince.size === 0 && this.trackTimer) {
      clearInterval(this.trackTimer);
      this.trackTimer = null;
    }
  }

  private async trackTick(): Promise<void> {
    if (this.trackTickInFlight) return;
    this.trackTickInFlight = true;
    try {
      const ids = Array.from(this.trackedSince.keys());
      for (const id of ids) {
        const since = this.trackedSince.get(id);
        if (since === undefined) continue;

        if (Date.now() - since >= VOICE_CLONING.STATUS_TRACK_TIMEOUT_MS) {
          this.finishTracking(id, {phase: 'timeout', errorMessage: null});
          continue;
        }

        try {
          const statusData = await VoiceProfileService.getVoiceProfileStatus(id);
          // A socket event may have resolved it while the request was out.
          if (!this.trackedSince.has(id)) continue;
          this.applyPolledStatus(
            id,
            statusData.status,
            statusData.errorMessage,
            statusData.contentLanguage,
          );
        } catch (error) {
          if (hasApiStatus(error, 404)) {
            this.finishTracking(id, {
              phase: 'failed',
              errorMessage: msg('voice.notFound'),
            });
          }
          // Other errors (offline, 5xx): keep trying until the cap; the
          // socket may still deliver the final status.
        }
      }
    } finally {
      this.trackTickInFlight = false;
    }
  }

  private applyPolledStatus(
    profileId: string,
    status: VoiceProfileStatus,
    errorMessage: string | null,
    contentLanguage: string | null = null,
  ): void {
    this.patchProfile(profileId, status, errorMessage, contentLanguage);
    if (status === VoiceProfileStatus.READY || status === VoiceProfileStatus.FAILED) {
      this.resolveTracked(profileId, status, errorMessage);
    }
  }

  private resolveTracked(
    profileId: string,
    status: VoiceProfileStatus,
    errorMessage: string | null,
  ): void {
    if (status === VoiceProfileStatus.READY) {
      this.finishTracking(profileId, {phase: 'ready', errorMessage: null});
    } else {
      this.finishTracking(profileId, {
        phase: 'failed',
        errorMessage: errorMessage ?? defaultTrainingFailedMessage(),
      });
    }
  }

  private finishTracking(profileId: string, state: TrackState): void {
    this.trackedSince.delete(profileId);
    this.trackStates.set(profileId, state);
    this.stopTrackTimerIfIdle();

    if (state.phase === 'timeout') return;

    this.loadVoiceSlots();
    if (!this.voiceProfiles.some(p => p.id === profileId)) {
      void this.loadVoiceProfiles({fresh: true});
    }

    // The Processing screen shows its own result; elsewhere, tell the user.
    if (this.trackingObservedId !== profileId) {
      if (state.phase === 'ready') {
        showToast.success(
          msg('voice.readyMessage'),
          msg('voice.readyTitle'),
        );
      } else {
        showToast.error(
          state.errorMessage ?? defaultTrainingFailedMessage(),
          msg('voice.failedTitle'),
        );
      }
    }
  }

  /**
   * After a list load: follow PROCESSING profiles that nobody tracks yet and
   * resolve tracked ones the list already shows as final. PENDING profiles
   * (no sample uploaded) are not polled; they cannot progress on their own.
   */
  private syncTrackingWithList(): void {
    for (const profile of this.voiceProfiles) {
      const tracked = this.trackedSince.has(profile.id);
      if (tracked) {
        if (
          profile.status === VoiceProfileStatus.READY ||
          profile.status === VoiceProfileStatus.FAILED
        ) {
          this.resolveTracked(profile.id, profile.status, profile.errorMessage);
        }
      } else if (profile.status === VoiceProfileStatus.PROCESSING) {
        this.trackVoiceProfile(profile.id);
      }
    }
  }

  /** Patch one profile's status in the list. Returns false if not listed. */
  private patchProfile(
    profileId: string,
    status: VoiceProfileStatus,
    errorMessage: string | null,
    contentLanguage: string | null = null,
  ): boolean {
    const index = this.voiceProfiles.findIndex(p => p.id === profileId);
    if (index === -1) return false;

    const prev = this.voiceProfiles[index];
    const next: VoiceProfile = {
      ...prev,
      // The status endpoint names the voice's language; keep ours without it.
      contentLanguage: contentLanguage || prev.contentLanguage,
      status,
      errorMessage:
        status === VoiceProfileStatus.FAILED
          ? errorMessage ?? prev.errorMessage
          : status === VoiceProfileStatus.READY
            ? null
            : prev.errorMessage,
    };
    this.voiceProfiles[index] = next;
    if (this.currentProfile?.id === profileId) {
      this.currentProfile = next;
    }
    return true;
  }

  // ============================================================================
  // Refresh / Cleanup
  // ============================================================================

  async refresh(): Promise<void> {
    await this.loadVoiceProfiles();
  }

  cleanup(): void {
    this.trackedSince.clear();
    this.stopTrackTimerIfIdle();
  }

  /**
   * Sign-out: forget the user's voices, slots and tracked trainings. An
   * answer still on its way for the previous session is dropped. The
   * catalogue and the clone config are the same for everyone and stay.
   */
  reset(): void {
    this.session += 1;
    this.loadPromise = null;
    this.freshLoadPromise = null;
    this.cleanup();
    this.pendingDiscardIds.clear();
    this.voiceProfiles = [];
    this.currentProfile = null;
    this.isLoading = false;
    this.hasLoadedProfiles = false;
    this.isMutating = false;
    this.errorMessage = '';
    this.voiceSlotInfo = null;
    this.isLoadingSlots = false;
    this.addingPresetIds.clear();
    this.removingProfileIds.clear();
    this.presetChanges = [];
    this.trackStates.clear();
    this.trackingObservedId = null;
  }
}

// ============================================================================
// Hook Export (Singleton Pattern)
// ============================================================================

let voiceProfileStoreInstance: VoiceProfileStore | null = null;

export function useVoiceProfile(): VoiceProfileStore {
  const store = useMemo(() => {
    if (!voiceProfileStoreInstance) {
      const instance = new VoiceProfileStore();
      voiceProfileStoreInstance = instance;
      // Socket `voice_status` events patch the store and resolve tracked
      // profiles immediately; the single poll loop is the fallback.
      WebSocketService.addVoiceStatusListener(instance);
      WebSocketService.setVoiceStatusFallback(() => {
        void instance.loadVoiceProfiles();
      });
      // The next account must never see this one's voices.
      registerSessionEndHandler(() => instance.reset());
    }
    return voiceProfileStoreInstance;
  }, []);

  return store;
}

export function getVoiceProfileStore(): VoiceProfileStore | null {
  return voiceProfileStoreInstance;
}

// Export for testing or direct access
export {VoiceProfileStore};
