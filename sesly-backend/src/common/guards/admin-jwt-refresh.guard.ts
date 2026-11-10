import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class AdminJwtRefreshGuard extends AuthGuard('admin-jwt-refresh') {}
