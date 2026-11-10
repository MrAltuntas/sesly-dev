import { AuthGuard } from '@nestjs/passport';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminJwtRefreshGuard } from './admin-jwt-refresh.guard';

describe('AdminJwtAuthGuard', () => {
  // AuthGuard(type) is memoized per strategy name, so the parent class
  // identifies the passport strategy the guard authenticates with.
  it('authenticates with the dedicated "admin-jwt" strategy (never the user "jwt" one)', () => {
    expect(Object.getPrototypeOf(AdminJwtAuthGuard)).toBe(AuthGuard('admin-jwt'));
    expect(Object.getPrototypeOf(AdminJwtAuthGuard)).not.toBe(AuthGuard('jwt'));
  });

  it('is a distinct strategy from the admin refresh guard', () => {
    expect(Object.getPrototypeOf(AdminJwtRefreshGuard)).not.toBe(AuthGuard('admin-jwt'));
  });

  it('is instantiable and exposes canActivate', () => {
    const guard = new AdminJwtAuthGuard();
    expect(typeof guard.canActivate).toBe('function');
  });
});
