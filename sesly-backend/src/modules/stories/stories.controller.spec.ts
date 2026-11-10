import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { StoriesController } from './stories.controller';

/**
 * Local helper: describe how each handler argument is sourced, based on the
 * Nest route-args metadata. Custom decorators (e.g. @CurrentUser) are
 * resolved by running their factory against a fake request so we assert the
 * value comes from `request.user.id`, not from the body/query.
 */
type ArgSource = { index: number; kind: string; data: unknown; factory?: (...a: any[]) => any };

function argSources(controller: any, method: string): ArgSource[] {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) || {};
  return Object.entries(meta)
    .map(([key, value]: [string, any]) => {
      if (key.includes('__customRouteArgs__')) {
        return { index: value.index, kind: 'custom', data: value.data, factory: value.factory };
      }
      const type = Number(key.split(':')[0]);
      return { index: value.index, kind: RouteParamtypes[type].toLowerCase(), data: value.data };
    })
    .sort((a, b) => a.index - b.index);
}

function resolveCustom(arg: ArgSource, req: any) {
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
  return arg.factory!(arg.data, ctx);
}

function isPublic(method: string): boolean {
  return Reflect.getMetadata(IS_PUBLIC_KEY, (StoriesController.prototype as any)[method]) === true;
}

describe('StoriesController', () => {
  let service: Record<string, jest.Mock>;
  let requests: Record<string, jest.Mock>;
  let controller: StoriesController;

  beforeEach(() => {
    service = {
      searchStories: jest.fn().mockResolvedValue('search-result'),
      getStories: jest.fn().mockResolvedValue('list-result'),
      getFavorites: jest.fn().mockResolvedValue('favorites-result'),
      getStory: jest.fn().mockResolvedValue('story-result'),
      getRelatedStories: jest.fn().mockResolvedValue('related-result'),
      updateProgress: jest.fn().mockResolvedValue('progress-result'),
      addToFavorites: jest.fn().mockResolvedValue('add-result'),
      removeFromFavorites: jest.fn().mockResolvedValue('remove-result'),
      getLanguages: jest.fn().mockResolvedValue('languages-result'),
    };
    requests = {
      request: jest.fn().mockResolvedValue('request-result'),
      withdraw: jest.fn().mockResolvedValue('withdraw-result'),
    };
    controller = new StoriesController(service as any, requests as any);
  });

  describe('auth surface', () => {
    it('only list, search and languages are @Public (optional auth)', () => {
      expect(isPublic('getStories')).toBe(true);
      expect(isPublic('searchStories')).toBe(true);
      expect(isPublic('getLanguages')).toBe(true);

      for (const m of ['getFavorites', 'getStory', 'getRelatedStories', 'updateProgress', 'addToFavorites', 'removeFromFavorites']) {
        expect(isPublic(m)).toBe(false);
      }
    });

    it.each([
      'searchStories',
      'getStories',
      'getFavorites',
      'getStory',
      'getRelatedStories',
      'updateProgress',
      'addToFavorites',
      'removeFromFavorites',
    ])('%s takes the user id from @CurrentUser(\'id\') (request.user.id) as its first argument', (method) => {
      const [first] = argSources(StoriesController, method);

      expect(first.index).toBe(0);
      expect(first.kind).toBe('custom');
      expect(first.data).toBe('id');
      expect(resolveCustom(first, { user: { id: 'jwt-user' }, body: { userId: 'body-user' } })).toBe(
        'jwt-user',
      );
      expect(resolveCustom(first, { body: { userId: 'body-user' } })).toBeUndefined();
    });

    it('no stories route reads a user id from the body, query or path', () => {
      // getLanguages takes no caller at all (same answer for everyone).
      const methods = Object.getOwnPropertyNames(StoriesController.prototype).filter(
        (m) => m !== 'constructor' && m !== 'getLanguages',
      );
      expect(argSources(StoriesController, 'getLanguages')).toHaveLength(0);
      for (const m of methods) {
        const args = argSources(StoriesController, m);
        expect(args.filter((a) => a.kind === 'custom')).toHaveLength(1);
        for (const arg of args.filter((a) => a.kind !== 'custom')) {
          expect(String(arg.data ?? '')).not.toMatch(/user/i);
        }
      }
    });

    it('static routes (search, favorites) are declared before GET :id so they are not shadowed', () => {
      const order = Object.getOwnPropertyNames(StoriesController.prototype);

      expect(order.indexOf('searchStories')).toBeLessThan(order.indexOf('getStory'));
      expect(order.indexOf('getFavorites')).toBeLessThan(order.indexOf('getStory'));
      expect(order.indexOf('getLanguages')).toBeLessThan(order.indexOf('getStory'));
    });
  });

  describe('getRelatedStories', () => {
    it('forwards the caller and the story id', async () => {
      await expect(controller.getRelatedStories('user-1', 'story-9')).resolves.toBe('related-result');
      expect(service.getRelatedStories).toHaveBeenCalledWith('user-1', 'story-9');
    });
  });

  describe('getStories (public)', () => {
    it('forwards the authenticated user id', async () => {
      const query = { page: 2, limit: 10 } as any;

      await expect(controller.getStories('user-1', query)).resolves.toBe('list-result');
      expect(service.getStories).toHaveBeenCalledWith('user-1', query);
    });

    it.each([undefined, '', null])('anonymous caller (%p) reaches the service as undefined', async (uid) => {
      await controller.getStories(uid as any, {} as any);

      expect(service.getStories).toHaveBeenCalledWith(undefined, {});
    });
  });

  describe('searchStories (public)', () => {
    it('forwards user id, q and pagination', async () => {
      await controller.searchStories('user-1', { q: 'kelo', page: 3, limit: 5 } as any);

      expect(service.searchStories).toHaveBeenCalledWith('user-1', 'kelo', {
        page: 3,
        limit: 5,
        language: undefined,
        languageLevel: undefined,
      });
    });

    it('forwards the content language and level filters', async () => {
      await controller.searchStories('user-1', {
        q: 'wolf',
        language: 'de',
        languageLevel: ['A2', 'B1'],
      } as any);

      expect(service.searchStories).toHaveBeenCalledWith('user-1', 'wolf', {
        page: 1,
        limit: 20,
        language: 'de',
        languageLevel: ['A2', 'B1'],
      });
    });

    it('anonymous caller reaches the service as undefined, pagination defaults 1/20', async () => {
      await controller.searchStories(undefined, { q: 'kelo' } as any);

      expect(service.searchStories).toHaveBeenCalledWith(undefined, 'kelo', {
        page: 1,
        limit: 20,
        language: undefined,
        languageLevel: undefined,
      });
    });
  });

  describe('getLanguages (public)', () => {
    it('delegates to the service', async () => {
      await expect(controller.getLanguages()).resolves.toBe('languages-result');
      expect(service.getLanguages).toHaveBeenCalledWith();
    });
  });

  describe('authenticated routes', () => {
    it('getFavorites forwards user id and pagination with 1/20 defaults', async () => {
      await controller.getFavorites('user-1', {} as any);
      await controller.getFavorites('user-1', { page: 4, limit: 7 } as any);

      const flat = { grouped: undefined, prefer: undefined };
      expect(service.getFavorites).toHaveBeenNthCalledWith(1, 'user-1', 1, 20, flat);
      expect(service.getFavorites).toHaveBeenNthCalledWith(2, 'user-1', 4, 7, flat);
    });

    it('getFavorites forwards grouped and prefer', async () => {
      await controller.getFavorites('user-1', { grouped: true, prefer: 'en' } as any);

      expect(service.getFavorites).toHaveBeenCalledWith('user-1', 1, 20, { grouped: true, prefer: 'en' });
    });

    it('translation requests: POST forwards the language of the body, DELETE the normalised path language', async () => {
      await expect(
        controller.requestTranslation('user-1', 'story-1', { language: 'en' } as any),
      ).resolves.toBe('request-result');
      expect(requests.request).toHaveBeenCalledWith('user-1', 'story-1', 'en');

      await expect(controller.withdrawTranslationRequest('user-1', 'story-1', 'EN-gb')).resolves.toBe(
        'withdraw-result',
      );
      expect(requests.withdraw).toHaveBeenCalledWith('user-1', 'story-1', 'en');
    });

    it('withdrawing with an unknown language is a 400 with the shared content language message', async () => {
      await expect(controller.withdrawTranslationRequest('user-1', 'story-1', 'xx')).rejects.toMatchObject({
        status: 400,
        message: 'errors.validation.contentLanguage',
      });
      expect(requests.withdraw).not.toHaveBeenCalled();
    });

    it('translation request routes need a user and the POST has its own hourly rate limit', () => {
      expect(isPublic('requestTranslation')).toBe(false);
      expect(isPublic('withdrawTranslationRequest')).toBe(false);
      const limit = Reflect.getMetadata(
        'THROTTLER:LIMITdefault',
        StoriesController.prototype.requestTranslation,
      );
      const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', StoriesController.prototype.requestTranslation);
      expect(limit).toBe(30);
      expect(ttl).toBe(60 * 60 * 1000);
    });

    it('getStory forwards user id and path id', async () => {
      await expect(controller.getStory('user-1', 'story-1')).resolves.toBe('story-result');
      expect(service.getStory).toHaveBeenCalledWith('user-1', 'story-1');
    });

    it('updateProgress uses the JWT user id and ignores any userId smuggled in the body', async () => {
      const dto = {
        voiceProfileId: 'voice-1',
        lastChunkIndex: 3,
        completedAt: '2026-09-27T20:00:00.000Z',
        userId: 'attacker',
      } as any;

      await controller.updateProgress('user-1', 'story-1', dto);

      expect(service.updateProgress).toHaveBeenCalledWith(
        'user-1',
        'story-1',
        'voice-1',
        3,
        '2026-09-27T20:00:00.000Z',
      );
    });

    it('addToFavorites / removeFromFavorites forward user id and path id', async () => {
      await controller.addToFavorites('user-1', 'story-1');
      await controller.removeFromFavorites('user-1', 'story-1');

      expect(service.addToFavorites).toHaveBeenCalledWith('user-1', 'story-1');
      expect(service.removeFromFavorites).toHaveBeenCalledWith('user-1', 'story-1');
    });
  });
});
