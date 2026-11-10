/**
 * useAddNarrator: one add per narrator at a time, the busy narrator exposed
 * as `addingId`, and every refusal explained (the slot check, the backend's
 * coded refusal, any other failure) without closing anything first.
 */

const mockShowDialog = jest.fn();
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

let mockPlanId: 'free' | 'mini' | 'premium' = 'free';
jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ planId: mockPlanId }),
}));

const mockVoiceStore = {
  voiceProfiles: [] as Array<{ id: string; voiceId: string }>,
  /** The loaded slots show a free place: the add skips the slot request. */
  canAddPresetNow: false,
  addingPresetIds: new Set<string>() as Set<string>,
  isAddingPreset: jest.fn((voiceId: string): boolean => mockVoiceStore.addingPresetIds.has(voiceId)),
  checkCanCreate: jest.fn(),
  slotBlock: jest.fn(),
  createVoiceProfile: jest.fn(),
};
jest.mock('../../hooks/useVoiceProfile', () => ({
  useVoiceProfile: () => mockVoiceStore,
}));

jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import { act, renderHook } from '@testing-library/react-native';
import { useAddNarrator } from './useAddNarrator';
import { mockNavigation } from '../../test-utils/mocks/navigation';
import { apiErrorFromResponse } from '../../services/ApiError';
import type { AvailableGoogleVoice, VoiceProfile } from '../../models/VoiceProfile';
import { TTSProvider, VoiceProfileStatus } from '../../types/enums';
import { showToast } from '../../utils/toast';

const voice = (name: string): AvailableGoogleVoice => ({
  id: `tr-TR-Chirp3-HD-${name}`,
  voiceId: `tr-TR-Chirp3-HD-${name}`,
  name,
  language: 'Turkish',
  languageCode: 'tr-TR',
  contentLanguage: 'tr',
  gender: 'female',
  description: '',
  provider: 'GOOGLE',
});

const created = (v: AvailableGoogleVoice): VoiceProfile => ({
  id: `vp-${v.name}`,
  name: v.name,
  status: VoiceProfileStatus.READY,
  provider: TTSProvider.GOOGLE,
  voiceId: v.voiceId,
  language: 'tr-TR',
  contentLanguage: 'tr',
  sampleAudioUrl: null,
  errorMessage: null,
  voiceModelId: null,
  kind: 'PRESET',
  consentAt: null,
  createdAt: new Date(2026, 9, 1),
  updatedAt: new Date(2026, 9, 1),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

type DialogButton = { text: string; style?: string; onPress?: () => void };
const lastDialog = () =>
  mockShowDialog.mock.calls[mockShowDialog.mock.calls.length - 1][0] as {
    title: string;
    message: string;
    buttons: DialogButton[];
  };

const presetLimit = apiErrorFromResponse(403, {
  statusCode: 403,
  code: 'PRESET_SLOT_LIMIT',
  limit: 3,
  message: 'En fazla 3 hazır ses ekleyebilirsin.',
});

beforeEach(() => {
  mockPlanId = 'free';
  mockVoiceStore.voiceProfiles = [];
  mockVoiceStore.canAddPresetNow = false;
  mockVoiceStore.addingPresetIds = new Set();
  mockVoiceStore.checkCanCreate.mockReset().mockResolvedValue(true);
  mockVoiceStore.slotBlock
    .mockReset()
    .mockReturnValue({ title: 'Hazır ses hakkın doldu', message: 'Dolu.', showPaywall: true });
  mockVoiceStore.createVoiceProfile.mockReset();
  mockShowDialog.mockReset();
  mockNavigation.navigate.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('useAddNarrator', () => {
  it('a double add creates one profile and exposes addingId meanwhile', async () => {
    const aoede = voice('Aoede');
    const answer = deferred<{ profile: VoiceProfile | null; error: unknown }>();
    mockVoiceStore.createVoiceProfile.mockReturnValueOnce(answer.promise);
    const { result } = renderHook(() => useAddNarrator());
    expect(result.current.addingId).toBeNull();

    let first!: Promise<VoiceProfile | null>;
    let second!: Promise<VoiceProfile | null>;
    await act(async () => {
      first = result.current.add(aoede);
      second = result.current.add(aoede);
    });
    expect(await second).toBeNull();
    expect(result.current.addingId).toBe(aoede.voiceId);

    await act(async () => {
      answer.resolve({ profile: created(aoede), error: null });
      await first;
    });
    expect((await first)?.id).toBe('vp-Aoede');
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1);
    expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledTimes(1);
    expect(result.current.addingId).toBeNull();
  });

  it('two different narrators may be added at the same time', async () => {
    const a = voice('Aoede');
    const b = voice('Kore');
    mockVoiceStore.createVoiceProfile.mockImplementation(({ voiceId }: { voiceId: string }) =>
      Promise.resolve({ profile: created(voiceId === a.voiceId ? a : b), error: null }),
    );
    const { result } = renderHook(() => useAddNarrator());

    let both!: Array<VoiceProfile | null>;
    await act(async () => {
      both = await Promise.all([result.current.add(a), result.current.add(b)]);
    });

    expect(both.map(p => p?.id)).toEqual(['vp-Aoede', 'vp-Kore']);
    expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(2);
  });

  it('a narrator already in the list is not added again', async () => {
    const aoede = voice('Aoede');
    mockVoiceStore.voiceProfiles = [{ id: 'vp-old', voiceId: aoede.voiceId }];
    const { result } = renderHook(() => useAddNarrator());

    let added!: VoiceProfile | null;
    await act(async () => {
      added = await result.current.add(aoede);
    });

    expect(added).toBeNull();
    expect(mockVoiceStore.checkCanCreate).not.toHaveBeenCalled();
    expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('full places: the block dialog in the order [cancel, plans] for a free user', async () => {
    mockVoiceStore.checkCanCreate.mockResolvedValueOnce(false);
    const order: string[] = [];
    const beforeLeave = jest.fn(() => order.push('beforeLeave'));
    mockNavigation.navigate.mockImplementation(() => order.push('navigate'));
    const { result } = renderHook(() => useAddNarrator());

    await act(async () => {
      expect(await result.current.add(voice('Aoede'), { beforeLeave })).toBeNull();
    });

    expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('preset', 'free');
    const dialog = lastDialog();
    expect(dialog.title).toBe('Hazır ses hakkın doldu');
    expect(dialog.buttons.map(b => b.text)).toEqual(['Vazgeç', 'Planları gör']);
    expect(dialog.buttons[0].style).toBe('cancel');
    // No close-first step: the dialog opens over the narrator sheet.
    expect(beforeLeave).not.toHaveBeenCalled();
    expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();

    // Cancel stays where the user is.
    dialog.buttons[0].onPress?.();
    expect(beforeLeave).not.toHaveBeenCalled();

    // Leaving for the plans closes the sheet first: its window would stay
    // over the plans screen.
    dialog.buttons[1].onPress?.();
    expect(order).toEqual(['beforeLeave', 'navigate']);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
    expect(result.current.addingId).toBeNull();
  });

  it('without beforeLeave the plans still open from the block dialog', async () => {
    mockVoiceStore.checkCanCreate.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useAddNarrator());

    await act(async () => {
      expect(await result.current.add(voice('Aoede'))).toBeNull();
    });

    lastDialog().buttons[1].onPress?.();
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });
    expect(result.current.addingId).toBeNull();
  });

  it('full places without a bigger plan: only OK', async () => {
    mockPlanId = 'premium';
    mockVoiceStore.checkCanCreate.mockResolvedValueOnce(false);
    mockVoiceStore.slotBlock.mockReturnValueOnce({
      title: 'Hazır ses hakkın doldu',
      message: 'Birini kaldır.',
      showPaywall: false,
    });
    const { result } = renderHook(() => useAddNarrator());

    await act(async () => {
      await result.current.add(voice('Aoede'));
    });

    expect(mockVoiceStore.slotBlock).toHaveBeenCalledWith('preset', 'premium');
    expect(lastDialog().buttons.map(b => b.text)).toEqual(['Tamam']);
  });

  it('the backend refuses with PRESET_SLOT_LIMIT: plans for free, none for premium or mini', async () => {
    mockVoiceStore.createVoiceProfile.mockResolvedValue({ profile: null, error: presetLimit });
    const beforeLeave = jest.fn();

    const free = renderHook(() => useAddNarrator());
    await act(async () => {
      await free.result.current.add(voice('Aoede'), { beforeLeave });
    });
    expect(lastDialog().title).toBe('Hazır ses hakkın doldu');
    expect(lastDialog().buttons.map(b => b.text)).toEqual(['Vazgeç', 'Planları gör']);
    // App copy, never the backend sentence.
    expect(lastDialog().message).not.toContain('En fazla 3');
    expect(beforeLeave).not.toHaveBeenCalled();
    lastDialog().buttons[1].onPress?.();
    expect(beforeLeave).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Subscription', { reason: 'voices' }, { pop: true });

    mockPlanId = 'premium';
    const premium = renderHook(() => useAddNarrator());
    await act(async () => {
      await premium.result.current.add(voice('Kore'), { beforeLeave });
    });
    expect(lastDialog().buttons.map(b => b.text)).toEqual(['Tamam']);

    // Mini has as many narrator places as Premium: no plans either.
    mockPlanId = 'mini';
    const mini = renderHook(() => useAddNarrator());
    await act(async () => {
      await mini.result.current.add(voice('Puck'), { beforeLeave });
    });
    expect(lastDialog().buttons.map(b => b.text)).toEqual(['Tamam']);
    lastDialog().buttons[0].onPress?.();
    expect(beforeLeave).toHaveBeenCalledTimes(1);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('another backend error shows its message as a snackbar, no dialog', async () => {
    mockVoiceStore.createVoiceProfile.mockResolvedValueOnce({
      profile: null,
      error: apiErrorFromResponse(undefined, null),
    });
    const { result } = renderHook(() => useAddNarrator());

    let added!: VoiceProfile | null;
    await act(async () => {
      added = await result.current.add(voice('Aoede'));
    });

    expect(added).toBeNull();
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(showToast.error).toHaveBeenCalledTimes(1);
    expect((showToast.error as jest.Mock).mock.calls[0][0]).toBe(
      apiErrorFromResponse(undefined, null).message,
    );
    expect(result.current.addingId).toBeNull();
  });

  it('a name the store refused (no error) shows nothing more', async () => {
    mockVoiceStore.createVoiceProfile.mockResolvedValueOnce({ profile: null, error: null });
    const { result } = renderHook(() => useAddNarrator());

    await act(async () => {
      expect(await result.current.add(voice('Aoede'))).toBeNull();
    });

    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(showToast.error).not.toHaveBeenCalled();
  });

  describe('a known free place adds at once (VR-03)', () => {
    it('the create starts in the tap itself, without asking the slots first', async () => {
      mockVoiceStore.canAddPresetNow = true;
      const aoede = voice('Aoede');
      const answer = deferred<{ profile: VoiceProfile | null; error: unknown }>();
      mockVoiceStore.createVoiceProfile.mockReturnValueOnce(answer.promise);
      const { result } = renderHook(() => useAddNarrator());

      let pending!: Promise<VoiceProfile | null>;
      act(() => {
        pending = result.current.add(aoede);
      });
      // Synchronously, before any answer: the request is out.
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1);
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledWith(
        expect.objectContaining({ voiceId: aoede.voiceId, name: 'Aoede' }),
      );
      expect(mockVoiceStore.checkCanCreate).not.toHaveBeenCalled();

      await act(async () => {
        answer.resolve({ profile: created(aoede), error: null });
        await pending;
      });
      expect((await pending)?.id).toBe('vp-Aoede');
    });

    it('the backend still refusing gets the slot dialog', async () => {
      mockVoiceStore.canAddPresetNow = true;
      mockVoiceStore.createVoiceProfile.mockResolvedValueOnce({ profile: null, error: presetLimit });
      const { result } = renderHook(() => useAddNarrator());

      await act(async () => {
        expect(await result.current.add(voice('Aoede'))).toBeNull();
      });

      expect(mockVoiceStore.checkCanCreate).not.toHaveBeenCalled();
      expect(lastDialog().title).toBe('Hazır ses hakkın doldu');
    });

    it('slots that are unknown or look full are asked first', async () => {
      mockVoiceStore.canAddPresetNow = false;
      mockVoiceStore.createVoiceProfile.mockResolvedValueOnce({ profile: created(voice('Kore')), error: null });
      const { result } = renderHook(() => useAddNarrator());

      await act(async () => {
        await result.current.add(voice('Kore'));
      });

      expect(mockVoiceStore.checkCanCreate).toHaveBeenCalledWith('preset');
      expect(mockVoiceStore.createVoiceProfile).toHaveBeenCalledTimes(1);
    });

    it('a narrator whose add another screen started is not added twice', async () => {
      const aoede = voice('Aoede');
      mockVoiceStore.addingPresetIds = new Set([aoede.voiceId]);
      const { result } = renderHook(() => useAddNarrator());

      await act(async () => {
        expect(await result.current.add(aoede)).toBeNull();
      });
      expect(mockVoiceStore.createVoiceProfile).not.toHaveBeenCalled();
    });
  });

  it('a thrown error: snackbar addFailed, null, and the narrator can be tried again', async () => {
    const aoede = voice('Aoede');
    mockVoiceStore.checkCanCreate.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAddNarrator());

    await act(async () => {
      expect(await result.current.add(aoede)).toBeNull();
    });
    expect(showToast.error).toHaveBeenCalledWith('Anlatıcı eklenemedi');
    expect(result.current.addingId).toBeNull();

    mockVoiceStore.createVoiceProfile.mockResolvedValueOnce({ profile: created(aoede), error: null });
    await act(async () => {
      expect((await result.current.add(aoede))?.id).toBe('vp-Aoede');
    });
  });
});
