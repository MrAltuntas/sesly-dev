/**
 * Adding a ready-made narrator of the catalogue to the user's voices.
 *
 * Used by the Sesim tab, the narrator catalogue and the narrator sheet of a
 * story. A ready-made narrator is free for every plan: there is no plan
 * check here, only the slot check (`GET /voice-profiles/slots` is
 * authoritative) and the backend's own refusal, both explained in a dialog.
 * The dialog opens where the user is, also over the narrator sheet (the
 * sheet hosts a dialog outlet), so nothing is closed first; only leaving for
 * the plans screen runs the caller's `beforeLeave` (a sheet closes there).
 *
 * One add per narrator at a time: a second tap while the first is still on
 * its way, or a tap on a narrator that is already in the list, adds nothing.
 * `addingId` names the narrator being added, so its row can show it is busy.
 *
 * The add is optimistic (VR-03): when the loaded slots already show a free
 * place, the create starts in the tap's own frame without asking the slots
 * first, and the store marks the narrator as added at once
 * (`voiceProfileStore.isAddingPreset`, counted in `presetSlots`); a refusal
 * or failure rolls the row back with its message. Only slots that are not
 * known yet, or that look full, are asked first.
 */

import { useCallback, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useVoiceProfile } from '../../hooks/useVoiceProfile';
import { useSubscription } from '../../hooks/useSubscription';
import { useDialog } from '../../hooks/useDialog';
import { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import { CLONE_ERROR_CODES, describeCloneError } from '../../models/VoiceClone';
import { getErrorMessage } from '../../services/ApiError';
import { TTSProvider } from '../../types/enums';
import { showToast } from '../../utils/toast';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export interface AddNarratorOptions {
  /**
   * Called when the user picks "Planları gör" in the block dialog, right
   * before the plans screen opens. A caller inside a sheet closes it here:
   * the sheet is its own window and would stay over the new screen. (The
   * dialog itself opens over the sheet, nothing is closed before it.)
   */
  readonly beforeLeave?: () => void;
}

export interface AddNarrator {
  /**
   * Add the narrator. Resolves to the new voice profile, or to null when it
   * was not added (the reason has been shown, or the narrator is already
   * being added or already in the list).
   */
  readonly add: (
    voice: AvailableGoogleVoice,
    options?: AddNarratorOptions,
  ) => Promise<VoiceProfile | null>;
  /**
   * Explain a limit; the plans are offered when a higher plan lifts it.
   * `beforeLeave` runs right before the plans screen opens (see
   * `AddNarratorOptions.beforeLeave`).
   */
  readonly showBlock: (
    title: string,
    message: string,
    showPaywall: boolean,
    beforeLeave?: () => void,
  ) => void;
  /** The voice id of the narrator being added, null while none is. */
  readonly addingId: string | null;
}

export function useAddNarrator(): AddNarrator {
  const nav = useNavigation<Nav>();
  const { t } = useTranslation('voices');
  const voiceProfileStore = useVoiceProfile();
  const subscriptionStore = useSubscription();
  const { showDialog } = useDialog();
  const planId = subscriptionStore.planId;
  // Read synchronously by a second tap that lands before a re-render.
  const pending = useRef(new Set<string>());
  const [addingId, setAddingId] = useState<string | null>(null);

  const showBlock = useCallback(
    (title: string, message: string, showPaywall: boolean, beforeLeave?: () => void) => {
      showDialog({
        title,
        message,
        // The same order everywhere: the way out first, then the plans.
        buttons: showPaywall
          ? [
              { text: t('common:cancel'), style: 'cancel' },
              {
                text: t('voices:dialogs.seePlans'),
                onPress: () => {
                  beforeLeave?.();
                  // The plans say why they opened (ux-22): more voices.
                  navigateSingleton(nav, 'Subscription', { reason: 'voices' });
                },
              },
            ]
          : [{ text: t('common:ok') }],
      });
    },
    [showDialog, t, nav],
  );

  const add = useCallback(
    async (
      voice: AvailableGoogleVoice,
      options: AddNarratorOptions = {},
    ): Promise<VoiceProfile | null> => {
      const { beforeLeave } = options;
      const voiceId = voice.voiceId;
      if (
        pending.current.has(voiceId) ||
        // Also an add started on another screen (the Sesim tab under the catalogue).
        voiceProfileStore.isAddingPreset(voiceId) ||
        voiceProfileStore.voiceProfiles.some(profile => profile.voiceId === voiceId)
      ) {
        return null;
      }
      pending.current.add(voiceId);
      setAddingId(voiceId);
      try {
        // A known free place needs no round trip first: the backend still
        // refuses with PRESET_SLOT_LIMIT, which gets the same dialog below.
        if (
          !voiceProfileStore.canAddPresetNow &&
          !(await voiceProfileStore.checkCanCreate('preset'))
        ) {
          const block = voiceProfileStore.slotBlock('preset', planId);
          showBlock(block.title, block.message, block.showPaywall, beforeLeave);
          return null;
        }
        const { profile, error } = await voiceProfileStore.createVoiceProfile({
          name: voice.name,
          provider: (voice.provider as TTSProvider) || TTSProvider.GOOGLE,
          voiceId,
          language: voice.languageCode || 'tr-TR',
        });
        if (profile) return profile;
        if (error) {
          // Slot codes get the slot dialog (with the plans when a higher
          // plan has more places), anything else the backend's own message.
          const info = describeCloneError(error, planId);
          if (info.action === 'paywall' || info.code === CLONE_ERROR_CODES.PRESET_SLOT_LIMIT) {
            showBlock(info.title, info.message, info.action === 'paywall', beforeLeave);
          } else {
            showToast.error(getErrorMessage(error, t('toasts.addFailed')));
          }
        }
        return null;
      } catch (err) {
        console.error('Failed to add preset voice:', err);
        showToast.error(t('toasts.addFailed'));
        return null;
      } finally {
        pending.current.delete(voiceId);
        setAddingId(current => (current === voiceId ? null : current));
      }
    },
    [voiceProfileStore, planId, showBlock, t],
  );

  return { add, showBlock, addingId };
}
