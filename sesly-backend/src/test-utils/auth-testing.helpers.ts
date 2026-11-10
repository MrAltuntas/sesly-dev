import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { AdminRole } from '@prisma/client';

/**
 * Generates a mock User JWT token for integration and E2E tests.
 */
export function mockUserAuthToken(userId: string, email: string = 'user@example.com'): string {
  const secret = process.env.JWT_SECRET || 'test-jwt-secret';
  const payload = {
    sub: userId,
    email: email,
  };
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

/**
 * Generates a mock Admin JWT token for integration and E2E tests.
 */
export function mockAdminAuthToken(
  adminId: string,
  role: AdminRole = AdminRole.ADMIN,
  email: string = 'admin@example.com'
): string {
  const secret = process.env.JWT_ADMIN_SECRET || process.env.JWT_SECRET || 'test-jwt-admin-secret';
  const payload = {
    sub: adminId,
    email: email,
    role: role,
  };
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

/**
 * Wraps supertest request to automatically include the Authorization header with a user JWT.
 */
export function authenticatedRequest(app: INestApplication, userId?: string, email?: string) {
  const agent = request(app.getHttpServer());
  
  if (userId) {
    const token = mockUserAuthToken(userId, email);
    
    // Intercept agent requests to attach auth header
    const originalRequest = agent.get;
    agent.get = (url: string) => originalRequest.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalPost = agent.post;
    agent.post = (url: string) => originalPost.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalPut = agent.put;
    agent.put = (url: string) => originalPut.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalDelete = agent.delete;
    agent.delete = (url: string) => originalDelete.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalPatch = agent.patch;
    agent.patch = (url: string) => originalPatch.call(agent, url).set('Authorization', `Bearer ${token}`);
  }
  
  return agent;
}

/**
 * Wraps supertest request to automatically include the Authorization header with an admin JWT.
 */
export function authenticatedAdminRequest(app: INestApplication, adminId?: string, role?: AdminRole) {
  const agent = request(app.getHttpServer());
  
  if (adminId) {
    const token = mockAdminAuthToken(adminId, role);
    
    // Intercept agent requests to attach auth header
    const originalRequest = agent.get;
    agent.get = (url: string) => originalRequest.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalPost = agent.post;
    agent.post = (url: string) => originalPost.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalPut = agent.put;
    agent.put = (url: string) => originalPut.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalDelete = agent.delete;
    agent.delete = (url: string) => originalDelete.call(agent, url).set('Authorization', `Bearer ${token}`);
    
    const originalPatch = agent.patch;
    agent.patch = (url: string) => originalPatch.call(agent, url).set('Authorization', `Bearer ${token}`);
  }
  
  return agent;
}
