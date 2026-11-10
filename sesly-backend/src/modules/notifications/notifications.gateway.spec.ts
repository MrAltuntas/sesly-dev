import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NotificationsGateway } from './notifications.gateway';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

function client(handshake: Partial<any> = {}, id = 'sock-1'): any {
  return {
    id,
    handshake: { auth: {}, headers: {}, ...handshake },
    join: jest.fn(),
    disconnect: jest.fn(),
  };
}

describe('NotificationsGateway (socket auth + delivery)', () => {
  const jwt = new JwtService();
  const config: any = {
    get: jest.fn((key: string) => (key === 'jwt.secret' ? ACCESS_SECRET : undefined)),
  };
  let gateway: NotificationsGateway;
  let prisma: { user: { findUnique: jest.Mock } };
  let emit: jest.Mock;
  let to: jest.Mock;
  let logSpies: jest.SpyInstance[];

  const accessToken = (sub: string) => jwt.sign({ sub, email: 'a@b.c' }, { secret: ACCESS_SECRET, expiresIn: '1h' });

  beforeEach(() => {
    logSpies = ['log', 'warn', 'error'].map((m) =>
      jest.spyOn(Logger.prototype, m as 'log').mockImplementation(() => undefined),
    );
    prisma = { user: { findUnique: jest.fn().mockResolvedValue({ tokenVersion: 0 }) } };
    gateway = new NotificationsGateway(jwt, config, prisma as any);
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to, emit: jest.fn() } as any;
    gateway.afterInit(gateway.server);
  });

  afterEach(() => logSpies.forEach((s) => s.mockRestore()));

  it('handshake.auth.token (mobile) -> joins the user room', async () => {
    const socket = client({ auth: { token: accessToken('user-1') } });
    await gateway.handleConnection(socket);
    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(config.get).toHaveBeenCalledWith('jwt.secret');
  });

  it('Authorization: Bearer header is accepted too', async () => {
    const socket = client({ headers: { authorization: `Bearer ${accessToken('user-2')}` } });
    await gateway.handleConnection(socket);
    expect(socket.join).toHaveBeenCalledWith('user:user-2');
  });

  it('no token -> disconnected, never joins a room', async () => {
    const socket = client();
    await gateway.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([
    ['garbage', 'not-a-jwt'],
    ['refresh token', jwt.sign({ sub: 'user-1' }, { secret: REFRESH_SECRET })],
    ['expired token', jwt.sign({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 }, { secret: ACCESS_SECRET })],
  ])('%s -> disconnected', async (_label, token) => {
    const socket = client({ auth: { token } });
    await gateway.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  describe('session revocation (same tv rule as the HTTP JwtStrategy)', () => {
    const tokenWith = (claims: Record<string, unknown>) =>
      jwt.sign({ email: 'a@b.c', ...claims }, { secret: ACCESS_SECRET, expiresIn: '1h' });

    it('loads only the token version of the token subject', async () => {
      await gateway.handleConnection(client({ auth: { token: accessToken('user-1') } }));

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { tokenVersion: true },
      });
    });

    it('current generation -> joins the user room', async () => {
      prisma.user.findUnique.mockResolvedValue({ tokenVersion: 2 });
      const socket = client({ auth: { token: tokenWith({ sub: 'user-1', tv: 2 }) } });

      await gateway.handleConnection(socket);

      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it.each([
      ['an older generation (logged out since)', { sub: 'user-1', tv: 1 }, { tokenVersion: 2 }],
      ['a pre-revocation token after the first bump', { sub: 'user-1' }, { tokenVersion: 1 }],
      ['a deleted account', { sub: 'user-1', tv: 0 }, null],
    ])('%s -> disconnected, never joins a room', async (_label, claims, row) => {
      prisma.user.findUnique.mockResolvedValue(row);
      const socket = client({ auth: { token: tokenWith(claims) } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
      expect((gateway as any).userSockets.size).toBe(0);
    });

    it('a signed token without sub -> disconnected without a DB lookup', async () => {
      const socket = client({ auth: { token: tokenWith({}) } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('a DB failure during the lookup -> disconnected', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('db down'));
      const socket = client({ auth: { token: accessToken('user-1') } });

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  it('sendToUser emits only to that user room', () => {
    gateway.sendToUser('user-1', 'narration_status', { status: 'READY' });
    expect(to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith('narration_status', { status: 'READY' });
  });

  it('broadcast emits to everyone', () => {
    gateway.broadcast('maintenance', { on: true });
    expect((gateway.server.emit as jest.Mock)).toHaveBeenCalledWith('maintenance', { on: true });
  });

  it('disconnect removes the socket mapping (multiple sockets per user)', async () => {
    const a = client({ auth: { token: accessToken('user-1') } }, 'sock-a');
    const b = client({ auth: { token: accessToken('user-1') } }, 'sock-b');
    await gateway.handleConnection(a);
    await gateway.handleConnection(b);

    const sockets = (gateway as any).userSockets as Map<string, string[]>;
    expect(sockets.get('user-1')).toEqual(['sock-a', 'sock-b']);

    gateway.handleDisconnect(a);
    expect(sockets.get('user-1')).toEqual(['sock-b']);
    gateway.handleDisconnect(b);
    expect(sockets.has('user-1')).toBe(false);

    // Unknown socket: no-op.
    expect(() => gateway.handleDisconnect(client({}, 'ghost'))).not.toThrow();
  });
});
