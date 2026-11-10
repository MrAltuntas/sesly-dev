import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AudioController } from './audio.controller';

function mockRes() {
  const res: any = {};
  res.redirect = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('AudioController', () => {
  let audioService: {
    generateAudio: jest.Mock;
    getUserAudioLibrary: jest.Mock;
    getAudioByIdForUser: jest.Mock;
    getStreamUrl: jest.Mock;
    deleteAudio: jest.Mock;
    isPremiumVoiceOf: jest.Mock;
  };
  let usage: { getEffectivePlan: jest.Mock; consumeNarration: jest.Mock; refundNarration: jest.Mock };
  let controller: AudioController;

  beforeEach(() => {
    audioService = {
      generateAudio: jest.fn().mockResolvedValue({ audioId: 'a1' }),
      getUserAudioLibrary: jest.fn().mockResolvedValue({ data: [] }),
      getAudioByIdForUser: jest.fn(),
      getStreamUrl: jest.fn().mockResolvedValue('https://signed.example/a1'),
      deleteAudio: jest.fn().mockResolvedValue({ message: 'ok' }),
      isPremiumVoiceOf: jest.fn().mockResolvedValue(false),
    };
    usage = {
      getEffectivePlan: jest.fn().mockResolvedValue('FREE'),
      consumeNarration: jest.fn().mockResolvedValue({ userId: 'user-1', premiumVoice: false, month: 10, year: 2026 }),
      refundNarration: jest.fn().mockResolvedValue(undefined),
    };
    controller = new AudioController(audioService as any, usage as any);
  });

  it('generate uses the authenticated user id, not anything from the body', async () => {
    await controller.generateAudio('user-1', {
      text: 'Merhaba',
      voiceProfileId: 'v1',
      title: 't',
      userId: 'attacker',
    } as any);

    expect(audioService.generateAudio).toHaveBeenCalledWith({
      text: 'Merhaba',
      voiceProfileId: 'v1',
      userId: 'user-1',
      title: 't',
    });
  });

  it('generate counts against the narration allowance of the voice tier', async () => {
    audioService.isPremiumVoiceOf.mockResolvedValue(true);
    await controller.generateAudio('user-1', { text: 'Merhaba', voiceProfileId: 'v1' } as any);
    expect(audioService.isPremiumVoiceOf).toHaveBeenCalledWith('user-1', 'v1');
    expect(usage.consumeNarration).toHaveBeenCalledWith('user-1', 'FREE', true);
    expect(usage.refundNarration).not.toHaveBeenCalled();
  });

  it('generate: a used-up allowance is a 403 and nothing is generated', async () => {
    usage.consumeNarration.mockRejectedValue(new ForbiddenException({ code: 'QUOTA_CLONE_LIFETIME' }));
    await expect(
      controller.generateAudio('user-1', { text: 'x', voiceProfileId: 'v1' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audioService.generateAudio).not.toHaveBeenCalled();
  });

  it('generate: a failure to start gives the narration back', async () => {
    audioService.generateAudio.mockRejectedValue(new Error('queue down'));
    await expect(
      controller.generateAudio('user-1', { text: 'x', voiceProfileId: 'v1' } as any),
    ).rejects.toThrow('queue down');
    expect(usage.refundNarration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', premiumVoice: false }),
    );
  });

  it('library / metadata / delete are scoped to the authenticated user', async () => {
    await controller.getLibrary('user-1', { page: 1 } as any);
    await controller.getAudio('user-1', 'a1');
    await controller.deleteAudio('user-1', 'a1');

    expect(audioService.getUserAudioLibrary).toHaveBeenCalledWith('user-1', { page: 1 });
    expect(audioService.getAudioByIdForUser).toHaveBeenCalledWith('a1', 'user-1');
    expect(audioService.deleteAudio).toHaveBeenCalledWith('a1', 'user-1');
  });

  describe('GET /audio/:id/stream', () => {
    it('READY -> 302 to the presigned URL', async () => {
      audioService.getAudioByIdForUser.mockResolvedValue({ status: 'READY', audioUrl: 'x' });
      const res = mockRes();

      await controller.streamAudio('user-1', 'a1', res);

      expect(audioService.getAudioByIdForUser).toHaveBeenCalledWith('a1', 'user-1');
      expect(audioService.getStreamUrl).toHaveBeenCalledWith('a1', 'user-1');
      expect(res.redirect).toHaveBeenCalledWith(302, 'https://signed.example/a1');
    });

    it('GENERATING -> 202 with progress', async () => {
      audioService.getAudioByIdForUser.mockResolvedValue({ status: 'GENERATING', progress: 40 });
      const res = mockRes();

      await controller.streamAudio('user-1', 'a1', res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'GENERATING', progress: 40 }),
      );
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('FAILED -> 422', async () => {
      audioService.getAudioByIdForUser.mockResolvedValue({ status: 'FAILED' });
      const res = mockRes();
      await controller.streamAudio('user-1', 'a1', res);
      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    });

    it('READY without a URL / PENDING -> 404', async () => {
      audioService.getAudioByIdForUser.mockResolvedValue({ status: 'READY', audioUrl: null });
      const res = mockRes();
      await controller.streamAudio('user-1', 'a1', res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(audioService.getStreamUrl).not.toHaveBeenCalled();
    });

    it("someone else's audio -> 403, never redirected", async () => {
      audioService.getAudioByIdForUser.mockRejectedValue(new ForbiddenException('nope'));
      const res = mockRes();
      await controller.streamAudio('user-1', 'a1', res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('missing audio -> 404; unexpected error -> 500', async () => {
      audioService.getAudioByIdForUser.mockRejectedValueOnce(new NotFoundException('yok'));
      const res1 = mockRes();
      await controller.streamAudio('user-1', 'a1', res1);
      expect(res1.status).toHaveBeenCalledWith(404);

      audioService.getAudioByIdForUser.mockRejectedValueOnce(new Error('db down'));
      const res2 = mockRes();
      await controller.streamAudio('user-1', 'a1', res2);
      expect(res2.status).toHaveBeenCalledWith(500);
    });
  });
});
