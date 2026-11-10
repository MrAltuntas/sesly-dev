import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator';

describe('AppController (health)', () => {
  const controller = new AppController(new AppService());

  it('GET /health is public and reports ok with uptime', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppController.prototype.getHealth)).toBe(true);
    const health = controller.getHealth();
    expect(health.status).toBe('ok');
    expect(typeof health.uptime).toBe('number');
    expect(() => new Date(health.timestamp).toISOString()).not.toThrow();
  });

  it('GET / is public and points at the docs', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppController.prototype.getInfo)).toBe(true);
    expect(controller.getInfo()).toMatchObject({ message: 'Sesly API v1.0', docs: '/api/docs' });
  });
});
