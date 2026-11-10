import { AuthGuard } from '@nestjs/passport';
import { JwtRefreshGuard } from './jwt-refresh.guard';
import { AdminJwtRefreshGuard } from './admin-jwt-refresh.guard';

describe('refresh token guards', () => {
  // AuthGuard(type) is memoized per strategy name, so the parent class tells
  // which passport strategy a guard authenticates with.
  it('user refresh guard uses the "jwt-refresh" strategy only', () => {
    expect(Object.getPrototypeOf(JwtRefreshGuard)).toBe(AuthGuard('jwt-refresh'));
    expect(Object.getPrototypeOf(JwtRefreshGuard)).not.toBe(AuthGuard('jwt'));
    expect(typeof new JwtRefreshGuard().canActivate).toBe('function');
  });

  it('admin refresh guard uses "admin-jwt-refresh", never the user refresh strategy', () => {
    expect(Object.getPrototypeOf(AdminJwtRefreshGuard)).toBe(AuthGuard('admin-jwt-refresh'));
    expect(Object.getPrototypeOf(AdminJwtRefreshGuard)).not.toBe(AuthGuard('jwt-refresh'));
    expect(typeof new AdminJwtRefreshGuard().canActivate).toBe('function');
  });
});
