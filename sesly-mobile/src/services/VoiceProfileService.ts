/**
 * Voice Profile Service
 * Handles voice profile CRUD and voice sample uploads
 */

import ApiClient from './ApiClient';
import {
    VoiceProfile,
    parseVoiceProfileFromJSON,
    VoiceSlotInfo,
    parseVoiceSlotInfoFromJSON,
    AvailableVoicesResponse,
    parseAvailableVoicesResponseFromJSON,
    VoiceProfileStatusResponse,
    parseVoiceProfileStatusResponseFromJSON,
    CreateVoiceProfileRequest,
    createVoiceProfileRequestToJSON, VoicePreviewResponse,
} from '../models/VoiceProfile';
import {
    CloneConfig,
    parseCloneConfigFromJSON,
    sampleFileTypeForUri,
} from '../models/VoiceClone';

// ============================================================================
// Voice Profile Service Class (Singleton)
// ============================================================================

class VoiceProfileService {
  private static instance: VoiceProfileService;

  private constructor() {}

  public static getInstance(): VoiceProfileService {
    if (!VoiceProfileService.instance) {
      VoiceProfileService.instance = new VoiceProfileService();
    }
    return VoiceProfileService.instance;
  }

  // ============================================================================
  // Voice Profile CRUD
  // ============================================================================

  /**
   * Get all voice profiles for current user
   *
   * @param language content language code ("tr", "en"): only the voices of
   *   that language. Without it every voice is returned.
   */
  public async getMyVoiceProfiles(language?: string): Promise<VoiceProfile[]> {
    try {
      const response = language
        ? await ApiClient.get<unknown>('/voice-profiles', { params: { language } })
        : await ApiClient.get<unknown>('/voice-profiles');

      if (!Array.isArray(response)) {
        throw new Error('Invalid response: expected array');
      }

      return response.map(item => parseVoiceProfileFromJSON(item));
    } catch (error) {
      console.error('Failed to get voice profiles:', error);
      throw error;
    }
  }

  /**
   * Create a new voice profile (Ready-made or Cloning placeholder)
   */
  public async createVoiceProfile(
    request: CreateVoiceProfileRequest,
  ): Promise<VoiceProfile> {
    if (!request.name) throw new Error('Missing required field: name');
    if (!request.provider) throw new Error('Missing required field: provider');
    if (!request.voiceId) throw new Error('Missing required field: voiceId');

    try {
      const response = await ApiClient.post<unknown>(
        '/voice-profiles/v2',
        createVoiceProfileRequestToJSON(request),
      );

      // Backend returns { profile: VoiceProfile, availableVoices: [] }
      if (!response || typeof response !== 'object' || !('profile' in response)) {
        throw new Error('Invalid response format: expected { profile, availableVoices }');
      }

      const data = response as { profile: unknown };
      return parseVoiceProfileFromJSON(data.profile);
    } catch (error) {
      console.error('Failed to create voice profile:', error);
      throw error;
    }
  }

  /**
   * Delete a voice profile
   */
  public async deleteVoiceProfile(id: string): Promise<void> {
    if (!id) {
      throw new Error('Voice profile ID is required');
    }

    try {
      await ApiClient.delete(`/voice-profiles/${id}`);
      console.log(`✅ Voice profile ${id} deleted`);
    } catch (error) {
      console.error(`Failed to delete voice profile ${id}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // Voice Slots
  // ============================================================================

  /**
   * GET /voice-profiles/slots: the ready-made and own-voice places, and the
   * plan's own-voice creation allowance (`clone.creations`: used, limit with
   * -1 for unlimited, period 'month' or 'lifetime', renewsAt, canCreate).
   */
  public async getVoiceSlots(): Promise<VoiceSlotInfo> {
    try {
      const response = await ApiClient.get<unknown>('/voice-profiles/slots');
      return parseVoiceSlotInfoFromJSON(response);
    } catch (error) {
      console.error('Failed to get voice slots:', error);
      throw error;
    }
  }

  // ============================================================================
  // Available Voices
  // ============================================================================

  /**
   * The ready-made narrator catalogue (Google Chirp 3 HD voices).
   *
   * @param language content language code ("tr", "en"): only the narrators
   *   that read that language. Without it the backend answers for its
   *   default content language.
   */
  public async getAvailableVoices(language?: string): Promise<AvailableVoicesResponse> {
    try {
      const response = await ApiClient.get<unknown>(
        '/voice-profiles/available-voices',
        language ? { params: { language } } : undefined,
      );
      return parseAvailableVoicesResponseFromJSON(response);
    } catch (error) {
      console.error('Failed to get available voices:', error);
      throw error;
    }
  }

  /**
   * Preview a voice by generating a sample audio
   */
  public async previewVoice(voiceId: string, provider: string) {
    try {
      const response = await ApiClient.post<VoicePreviewResponse>(
        '/voice-profiles/preview',
        { voiceId, provider },
      );
      return response as VoicePreviewResponse;
    } catch (error) {
      console.error('Failed to preview voice:', error);
      throw error;
    }
  }

  // ============================================================================
  // Clone config + sample upload (for cloning)
  // ============================================================================

  /**
   * GET /voice-profiles/clone-config: durations, reading script, intro steps,
   * tips and the consent text/version, in the language the user will speak,
   * plus the languages a voice can be recorded in. Throws when the response
   * lacks the consent fields (the flow must not record without them).
   *
   * @param language voice language code ("tr", "en"). Without it the backend
   *   answers in Turkish. A language that is not offered is refused with 400
   *   VOICE_LANGUAGE_NOT_SUPPORTED.
   */
  public async getCloneConfig(language?: string | null): Promise<CloneConfig> {
    const response = language
      ? await ApiClient.get<unknown>('/voice-profiles/clone-config', { params: { language } })
      : await ApiClient.get<unknown>('/voice-profiles/clone-config');
    return parseCloneConfigFromJSON(response);
  }

  /**
   * Upload the recorded reference take for a PENDING clone profile.
   *
   * Multipart fields: `referenceAudio` (file), `consentVersion` (the version
   * the user accepted on the consent step: the one of the profile's own
   * language, the backend checks it against that) and optionally `speechStartMs`
   * (ms offset of the first detected speech in the file, integer as string).
   * iOS records LPCM WAV (audio/wav), Android AAC in MPEG-4 (audio/m4a).
   *
   * Refusals come back as ApiError with a code (`describeCloneError` maps
   * them): 400 CONSENT_REQUIRED, 403 CLONE_SLOT_LIMIT / CLONE_CREATION_LIMIT
   * (the allowance is checked again at upload), 409 VOICE_ALREADY_UPLOADED,
   * and 404 when the PENDING profile no longer exists.
   */
  public async uploadCloneSample(
    profileId: string,
    sample: {
      fileUri: string;
      consentVersion: string;
      speechStartMs?: number | null;
    },
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    if (!profileId) {
      throw new Error('Voice profile ID is required');
    }
    if (!sample.fileUri) {
      throw new Error('Reference audio file path is required');
    }
    if (!sample.consentVersion) {
      throw new Error('Consent version is required');
    }

    try {
      const formData = new FormData();
      const { mimeType, extension } = sampleFileTypeForUri(sample.fileUri);

      // React Native FormData file part: { uri, type, name }.
      formData.append('referenceAudio', {
        uri: sample.fileUri,
        type: mimeType,
        name: `reference_${Date.now()}.${extension}`,
      } as unknown as Blob);
      formData.append('consentVersion', sample.consentVersion);
      if (
        typeof sample.speechStartMs === 'number' &&
        Number.isFinite(sample.speechStartMs) &&
        sample.speechStartMs >= 0
      ) {
        formData.append('speechStartMs', String(Math.round(sample.speechStartMs)));
      }

      await ApiClient.upload(
        `/voice-profiles/${profileId}/upload-samples`,
        formData,
        progressEvent => {
          if (onProgress && progressEvent.total) {
            const progress = Math.round(
              (progressEvent.loaded / progressEvent.total) * 100,
            );
            onProgress(progress);
          }
        },
      );

      console.log(`Voice sample uploaded for profile ${profileId}`);
    } catch (error) {
      console.error(`Failed to upload voice sample for ${profileId}:`, error);
      throw error;
    }
  }

  // ============================================================================
  // Voice Profile Status (for polling during training)
  // ============================================================================

  /**
   * Get voice profile status (for polling during cloning/training)
   */
  public async getVoiceProfileStatus(
    id: string,
  ): Promise<VoiceProfileStatusResponse> {
    if (!id) {
      throw new Error('Voice profile ID is required');
    }

    try {
      const response = await ApiClient.get<unknown>(
        `/voice-profiles/${id}/status`,
      );
      
      // Check if response is actually an error object (if ApiClient doesn't throw on 404)
      if (response && typeof response === 'object' && 'statusCode' in response) {
          const err = response as {statusCode: number; message: string};
          if (err.statusCode === 404) {
             throw new Error('Voice profile not found');
          }
      }

      return parseVoiceProfileStatusResponseFromJSON(response);
    } catch (error) {
      console.error(`Failed to get voice profile status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get voice sample URL (for preview/playback)
   */
  public async getVoiceSample(
    id: string,
  ): Promise<{audioUrl: string} | null> {
    if (!id) {
      throw new Error('Voice profile ID is required');
    }

    try {
      const response = await ApiClient.get<unknown>(
        `/voice-profiles/${id}/sample`,
      );

      if (
        !response ||
        typeof response !== 'object' ||
        !('audioUrl' in response)
      ) {
        return null;
      }

      const data = response as {audioUrl?: string};

      if (typeof data.audioUrl !== 'string' || !data.audioUrl) {
        return null;
      }

      return {audioUrl: data.audioUrl};
    } catch (error) {
      console.error(`Failed to get voice sample for ${id}:`, error);
      return null;
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default VoiceProfileService.getInstance();
