import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      message: 'Sesly API v1.0',
      docs: '/api/docs',
      timestamp: new Date().toISOString(),
    };
  }

  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
