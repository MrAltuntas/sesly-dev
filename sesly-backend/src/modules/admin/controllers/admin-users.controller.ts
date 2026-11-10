import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminUsersService } from '../services/admin-users.service';
import { AdminService } from '../admin.service';
import { AdminJwtAuthGuard } from '../../../common/guards/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { UserListQueryDto } from '../dto/user-list-query.dto';
import { CreatePromoCodeDto } from '../dto/create-promocode.dto';
import { GrantAccessDto } from '../dto/grant-access.dto';
import { GrantSubscriptionDto } from '../dto/grant-subscription.dto';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Admin - Users')
@ApiBearerAuth()
@Controller('admin')
@Public() // Bypass global User JWT guard
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@AdminRoles('SUPER_ADMIN', 'ADMIN', 'MODERATOR')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly adminService: AdminService,
  ) {}

  // ===== Users =====

  @Get('users/stats')
  @ApiOperation({ summary: 'Get user statistics (Admin)' })
  @ApiResponse({ status: 200, description: 'User stats retrieved' })
  async getUserStats() {
    return this.adminUsersService.getUserStats();
  }

  @Get('users')
  @ApiOperation({ summary: 'Get all users with pagination (Admin)' })
  @ApiResponse({ status: 200, description: 'Users retrieved' })
  async getAllUsers(@Query() queryDto: UserListQueryDto) {
    return this.adminUsersService.getAllUsers(
      queryDto.page || 1,
      queryDto.limit || 20,
      queryDto.search,
    );
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user by ID with full details (Admin)' })
  @ApiResponse({ status: 200, description: 'User retrieved' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id') userId: string) {
    return this.adminUsersService.getUserById(userId);
  }

  @Patch('users/:id/deactivate')
  @AdminRoles('SUPER_ADMIN', 'ADMIN') // Only SUPER_ADMIN and ADMIN can deactivate
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate user account (Admin)' })
  @ApiResponse({ status: 200, description: 'User deactivated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deactivateUser(@Param('id') userId: string) {
    return this.adminUsersService.deactivateUser(userId);
  }

  @Delete('users/:id')
  @AdminRoles('SUPER_ADMIN') // Only SUPER_ADMIN can delete
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete user account permanently (Admin)' })
  @ApiResponse({ status: 200, description: 'User deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async deleteUser(@Param('id') userId: string) {
    return this.adminUsersService.deleteUser(userId);
  }

  // ===== Subscription Management =====

  @Patch('users/:id/subscription')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant or update subscription for a user by ID (Admin)' })
  @ApiResponse({ status: 200, description: 'Subscription updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async grantUserSubscription(
    @Param('id') userId: string,
    @Body() dto: GrantSubscriptionDto,
  ) {
    return this.adminUsersService.grantSubscription(userId, dto);
  }

  // ===== Finance =====

  @Post('finance/promocodes')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create a new discount code' })
  async createPromoCode(@Body() dto: CreatePromoCodeDto) {
    return this.adminService.createPromoCode(dto);
  }

  @Get('finance/promocodes')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'List all active codes' })
  async getPromoCodes() {
    return this.adminService.getPromoCodes();
  }

  @Post('finance/grant-access')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Manually give Subscription to a user' })
  async grantAccess(@Body() dto: GrantAccessDto) {
    return this.adminService.grantAccess(dto);
  }
}
