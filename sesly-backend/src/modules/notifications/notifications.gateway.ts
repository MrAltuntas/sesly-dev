import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { isTokenVersionCurrent } from '../../common/utils/token-version';

@WebSocketGateway({
  cors: {
    origin: '*', // In production, replace with specific origins
  },
  namespace: 'notifications',
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('NotificationsGateway');
  private userSockets: Map<string, string[]> = new Map(); // userId -> [socketId, socketId]

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway Initialized');
  }

  async handleConnection(client: Socket) {
    try {
      // Extract token from query or headers
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} tried to connect without token`);
        client.disconnect();
        return;
      }

      // Verify token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('jwt.secret'),
      });

      const userId = payload.sub; // Assuming 'sub' is userId in JWT payload

      // Same revocation rule as the HTTP JwtStrategy: the account must still
      // exist and the token must carry its current session generation (a
      // logout / deactivation bumps users.tokenVersion).
      const user =
        typeof userId === 'string' && userId.length > 0
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { tokenVersion: true },
            })
          : null;
      if (!user || !isTokenVersionCurrent(payload, user.tokenVersion)) {
        this.logger.warn(`Client ${client.id} rejected: session revoked or user gone`);
        client.disconnect();
        return;
      }

      // Store socket mapping
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, []);
      }
      this.userSockets.get(userId)?.push(client.id);

      // Join user room for targeted broadcasting
      client.join(`user:${userId}`);

      this.logger.log(`Client connected: ${client.id} (User: ${userId})`);
    } catch (error) {
      this.logger.error(`Connection unauthorized: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // Remove socket from mapping
    for (const [userId, sockets] of this.userSockets.entries()) {
      const index = sockets.indexOf(client.id);
      if (index !== -1) {
        sockets.splice(index, 1);
        if (sockets.length === 0) {
          this.userSockets.delete(userId);
        }
        this.logger.log(`Client disconnected: ${client.id} (User: ${userId})`);
        break;
      }
    }
  }

  /**
   * Send a notification to a specific user
   */
  sendToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
    this.logger.log(`Sent '${event}' to user ${userId}`);
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }
}
