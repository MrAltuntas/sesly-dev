import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import { CurrentAdmin } from './current-admin.decorator';
import { IS_PUBLIC_KEY, Public } from './public.decorator';
import { ROLES_KEY, Roles } from './roles.decorator';
import { ADMIN_ROLES_KEY, AdminRoles } from './admin-roles.decorator';
import { ApiPagination } from './pagination.decorator';
import { BusinessException } from '../exceptions/business.exception';

/** Extract the factory Nest runs for a custom param decorator. */
function paramFactory(decorator: (...args: any[]) => ParameterDecorator, data?: unknown) {
  class Probe {
    handler(@decorator(data) _value: unknown) {
      return _value;
    }
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  return args[Object.keys(args)[0]].factory as (data: unknown, ctx: any) => unknown;
}

function ctxWithUser(user: unknown): any {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) };
}

describe('@CurrentUser', () => {
  it("@CurrentUser('id') returns the authenticated user id from the JWT strategy", () => {
    const factory = paramFactory(CurrentUser, 'id');
    expect(factory('id', ctxWithUser({ id: 'user-1', email: 'a@b.c' }))).toBe('user-1');
  });

  it('@CurrentUser() returns the whole user; anonymous requests yield undefined', () => {
    const factory = paramFactory(CurrentUser);
    const user = { id: 'user-1' };
    expect(factory(undefined, ctxWithUser(user))).toBe(user);
    expect(factory(undefined, ctxWithUser(undefined))).toBeUndefined();
    expect(factory('id', ctxWithUser(undefined))).toBeUndefined();
  });
});

describe('@CurrentAdmin', () => {
  it('reads the admin attached by the admin JWT strategy', () => {
    const factory = paramFactory(CurrentAdmin, 'role');
    expect(factory('role', ctxWithUser({ id: 'adm', role: 'SUPER_ADMIN' }))).toBe('SUPER_ADMIN');
    expect(paramFactory(CurrentAdmin)(undefined, ctxWithUser({ id: 'adm' }))).toEqual({ id: 'adm' });
  });
});

describe('@Roles / @AdminRoles / @ApiPagination', () => {
  it('store the role lists the guards read', () => {
    class C {
      @Roles('ADMIN', 'USER')
      a() {
        return 1;
      }
      @AdminRoles('SUPER_ADMIN' as any)
      b() {
        return 2;
      }
      @ApiPagination()
      c() {
        return 3;
      }
    }
    expect(Reflect.getMetadata(ROLES_KEY, C.prototype.a)).toEqual(['ADMIN', 'USER']);
    expect(Reflect.getMetadata(ADMIN_ROLES_KEY, C.prototype.b)).toEqual(['SUPER_ADMIN']);
    expect(Reflect.getMetadata('swagger/apiParameters', C.prototype.c)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'page', in: 'query' }),
        expect.objectContaining({ name: 'limit', in: 'query' }),
      ]),
    );
  });
});

describe('BusinessException', () => {
  it('defaults to 400 and keeps the message', () => {
    const e = new BusinessException('Olmaz.');
    expect(e.getStatus()).toBe(400);
    expect(e.message).toBe('Olmaz.');
    expect(new BusinessException('x', 409).getStatus()).toBe(409);
  });
});

describe('@Public', () => {
  it('sets the metadata the global JwtAuthGuard checks', () => {
    class C {
      @Public()
      open() {
        return true;
      }
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, C.prototype.open)).toBe(true);
  });
});
