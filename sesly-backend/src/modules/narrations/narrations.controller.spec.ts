import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NarrationsController } from './narrations.controller';

describe('NarrationsController', () => {
  let service: Record<string, jest.Mock>;
  let controller: NarrationsController;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
      findAll: jest.fn().mockResolvedValue({ data: [] }),
      findByStory: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'n1' }),
      generateAudio: jest.fn().mockResolvedValue({ status: 'GENERATING' }),
      getGenerationStatus: jest.fn().mockResolvedValue({ status: 'READY' }),
      getStreamUrl: jest.fn().mockResolvedValue('https://signed.example/full.mp3'),
      remove: jest.fn().mockResolvedValue({ message: 'ok' }),
    };
    controller = new NarrationsController(service as any);
  });

  it('every route passes the authenticated user id to the service', async () => {
    const dto = { storyId: 's1', voiceProfileId: 'v1' };
    await controller.create('user-1', dto as any);
    await controller.findAll('user-1', { page: 2 } as any);
    await controller.findByStory('s1', 'user-1');
    await controller.findOne('n1', 'user-1');
    await controller.generateAudio('n1', 'user-1');
    await controller.getGenerationStatus('n1', 'user-1');
    await controller.remove('n1', 'user-1');

    expect(service.create).toHaveBeenCalledWith('user-1', dto);
    expect(service.findAll).toHaveBeenCalledWith('user-1', { page: 2 });
    expect(service.findByStory).toHaveBeenCalledWith('s1', 'user-1');
    expect(service.findOne).toHaveBeenCalledWith('n1', 'user-1');
    expect(service.generateAudio).toHaveBeenCalledWith('n1', 'user-1');
    expect(service.getGenerationStatus).toHaveBeenCalledWith('n1', 'user-1');
    expect(service.remove).toHaveBeenCalledWith('n1', 'user-1');
  });

  describe('GET /narrations/:id/stream', () => {
    it('redirects to the presigned URL resolved for the caller', async () => {
      const res: any = { redirect: jest.fn() };

      await controller.stream('n1', 'user-1', res);

      expect(service.getStreamUrl).toHaveBeenCalledWith('n1', 'user-1');
      expect(res.redirect).toHaveBeenCalledWith('https://signed.example/full.mp3');
    });

    it('ownership / not-ready errors propagate (global filter renders them); no redirect', async () => {
      const res: any = { redirect: jest.fn() };

      service.getStreamUrl.mockRejectedValueOnce(new BadRequestException('Bu seslendirme sana ait değil.'));
      await expect(controller.stream('n1', 'user-2', res)).rejects.toBeInstanceOf(BadRequestException);

      service.getStreamUrl.mockRejectedValueOnce(new NotFoundException('Ses henüz hazır değil.'));
      await expect(controller.stream('n1', 'user-1', res)).rejects.toBeInstanceOf(NotFoundException);

      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
