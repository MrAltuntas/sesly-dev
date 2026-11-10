import 'reflect-metadata';
import { ParseUUIDPipe } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { PlaylistsController } from './playlists.controller';

/** Local helper: how each handler argument is sourced (Nest route-args metadata). */
type ArgSource = {
  index: number;
  kind: string;
  data: unknown;
  pipes: any[];
  factory?: (...a: any[]) => any;
};

function argSources(method: string): ArgSource[] {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, PlaylistsController, method) || {};
  return Object.entries(meta)
    .map(([key, value]: [string, any]) => {
      if (key.includes('__customRouteArgs__')) {
        return { index: value.index, kind: 'custom', data: value.data, pipes: value.pipes, factory: value.factory };
      }
      const type = Number(key.split(':')[0]);
      return { index: value.index, kind: RouteParamtypes[type].toLowerCase(), data: value.data, pipes: value.pipes };
    })
    .sort((a, b) => a.index - b.index);
}

const HANDLERS = ['list', 'create', 'getOne', 'update', 'remove', 'listItems', 'addItem', 'removeItem', 'reorder'];

describe('PlaylistsController', () => {
  let service: Record<string, jest.Mock>;
  let controller: PlaylistsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue(['pl']),
      create: jest.fn().mockResolvedValue('created'),
      getOne: jest.fn().mockResolvedValue('one'),
      update: jest.fn().mockResolvedValue('updated'),
      remove: jest.fn().mockResolvedValue(undefined),
      listItems: jest.fn().mockResolvedValue('items'),
      addItem: jest.fn().mockResolvedValue('item'),
      removeItem: jest.fn().mockResolvedValue(undefined),
      reorderItems: jest.fn().mockResolvedValue(['reordered']),
    };
    controller = new PlaylistsController(service as any);
  });

  describe('auth surface', () => {
    it('no playlist route is @Public', () => {
      for (const m of HANDLERS) {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, (PlaylistsController.prototype as any)[m])).toBeUndefined();
      }
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, PlaylistsController)).toBeUndefined();
    });

    it.each(HANDLERS)('%s takes the owner id from @CurrentUser(\'id\') (request.user.id) as its first argument', (m) => {
      const args = argSources(m);
      const first = args[0];

      expect(first.index).toBe(0);
      expect(first.kind).toBe('custom');
      expect(first.data).toBe('id');
      const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) });
      expect(first.factory!('id', ctx({ user: { id: 'jwt-user' }, body: { userId: 'body-user' } }))).toBe('jwt-user');
      expect(args.filter((a) => a.kind === 'custom')).toHaveLength(1);
    });

    it.each(['getOne', 'update', 'remove', 'listItems', 'addItem', 'removeItem', 'reorder'])(
      '%s validates path ids with ParseUUIDPipe',
      (m) => {
        const params = argSources(m).filter((a) => a.kind === 'param');

        expect(params.length).toBeGreaterThan(0);
        for (const p of params) {
          expect(p.pipes).toContain(ParseUUIDPipe);
        }
      },
    );
  });

  describe('delegation', () => {
    it('list', async () => {
      await expect(controller.list('user-1')).resolves.toEqual(['pl']);
      expect(service.list).toHaveBeenCalledWith('user-1');
    });

    it('create passes the JWT user id, never a body-supplied one', async () => {
      const dto = { name: 'Bu gece', userId: 'attacker' } as any;

      await controller.create('user-1', dto);

      expect(service.create).toHaveBeenCalledWith('user-1', dto);
      expect(service.create.mock.calls[0][0]).toBe('user-1');
    });

    it('getOne / update / remove', async () => {
      await controller.getOne('user-1', 'pl-1');
      await controller.update('user-1', 'pl-1', { name: 'x' });
      await expect(controller.remove('user-1', 'pl-1')).resolves.toBeUndefined();

      expect(service.getOne).toHaveBeenCalledWith('user-1', 'pl-1');
      expect(service.update).toHaveBeenCalledWith('user-1', 'pl-1', { name: 'x' });
      expect(service.remove).toHaveBeenCalledWith('user-1', 'pl-1');
    });

    it('listItems / addItem / removeItem / reorder', async () => {
      const pagination = { page: 2, limit: 10 };
      const addDto = { storyId: 'story-1' };
      const reorderDto = { itemIds: ['i1', 'i2'] };

      await controller.listItems('user-1', 'pl-1', pagination);
      await controller.addItem('user-1', 'pl-1', addDto);
      await expect(controller.removeItem('user-1', 'pl-1', 'item-1')).resolves.toBeUndefined();
      await expect(controller.reorder('user-1', 'pl-1', reorderDto)).resolves.toEqual(['reordered']);

      expect(service.listItems).toHaveBeenCalledWith('user-1', 'pl-1', pagination);
      expect(service.addItem).toHaveBeenCalledWith('user-1', 'pl-1', addDto);
      expect(service.removeItem).toHaveBeenCalledWith('user-1', 'pl-1', 'item-1');
      expect(service.reorderItems).toHaveBeenCalledWith('user-1', 'pl-1', reorderDto);
    });
  });
});
