import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { CollectionsController } from './collections.controller';

/** Local helper: custom (createParamDecorator) args of a handler. */
function customArgs(method: string) {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, CollectionsController, method) || {};
  return Object.entries(meta)
    .filter(([key]) => key.includes('__customRouteArgs__'))
    .map(([, value]: [string, any]) => value as { index: number; data: unknown; factory: (...a: any[]) => any });
}

describe('CollectionsController', () => {
  let service: Record<string, jest.Mock>;
  let controller: CollectionsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue(['list']),
      getBySlug: jest.fn().mockResolvedValue('one'),
      getStories: jest.fn().mockResolvedValue('stories'),
    };
    controller = new CollectionsController(service as any);
  });

  it('every public collections route is @Public', () => {
    for (const m of ['list', 'getBySlug', 'getStories']) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, (CollectionsController.prototype as any)[m])).toBe(true);
    }
  });

  it('getStories reads the optional user id from @CurrentUser(\'id\') (request.user.id)', () => {
    const args = customArgs('getStories');

    expect(args).toHaveLength(1);
    expect(args[0].index).toBe(2);
    expect(args[0].data).toBe('id');
    const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) });
    expect(args[0].factory('id', ctx({ user: { id: 'jwt-user' } }))).toBe('jwt-user');
    expect(args[0].factory('id', ctx({ query: { userId: 'q-user' } }))).toBeUndefined();
  });

  it('list and getBySlug do not depend on the caller', () => {
    expect(customArgs('list')).toHaveLength(0);
    expect(customArgs('getBySlug')).toHaveLength(0);
  });

  it('list delegates to the service', async () => {
    await expect(controller.list({} as any)).resolves.toEqual(['list']);
    expect(service.list).toHaveBeenCalledWith(undefined);
  });

  it('list forwards the explicit content language', async () => {
    await controller.list({ language: 'en' } as any);
    expect(service.list).toHaveBeenCalledWith('en');
  });

  it('getBySlug forwards the slug', async () => {
    await expect(controller.getBySlug('sleep', {} as any)).resolves.toBe('one');
    expect(service.getBySlug).toHaveBeenCalledWith('sleep', undefined);

    await controller.getBySlug('sleep', { language: 'de' } as any);
    expect(service.getBySlug).toHaveBeenLastCalledWith('sleep', 'de');
  });

  it('getStories forwards slug, pagination and the authenticated user id', async () => {
    await controller.getStories('sleep', { page: 2, limit: 5 } as any, 'user-1');

    expect(service.getStories).toHaveBeenCalledWith('sleep', 2, 5, 'user-1', undefined);

    await controller.getStories('sleep', { page: 1, limit: 20, language: 'en' } as any, 'user-1');
    expect(service.getStories).toHaveBeenLastCalledWith('sleep', 1, 20, 'user-1', 'en');
  });

  it.each([undefined, ''])('getStories for an anonymous caller (%p) passes undefined and 1/20 defaults', async (uid) => {
    await controller.getStories('sleep', {} as any, uid as any);

    expect(service.getStories).toHaveBeenCalledWith('sleep', 1, 20, undefined, undefined);
  });
});
