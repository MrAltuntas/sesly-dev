import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserStatsDto } from './dto/user-stats.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { StoriesService } from '../stories/stories.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private storiesService: StoriesService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved', type: UserResponseDto })
  async getCurrentUser(@CurrentUser('id') userId: string) {
    return this.usersService.getCurrentUser(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'User profile updated', type: UserResponseDto })
  async updateUser(
    @CurrentUser('id') userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(userId, updateUserDto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete current user account' })
  @ApiResponse({ status: 200, description: 'Account deleted successfully' })
  async deleteUser(@CurrentUser('id') userId: string) {
    return this.usersService.deleteUser(userId);
  }

  @Get('me/profile')
  @ApiOperation({ summary: 'Get extended user profile with subscription and usage data' })
  @ApiResponse({ status: 200, description: 'Extended profile retrieved' })
  async getUserProfile(@CurrentUser('id') userId: string) {
    return this.usersService.getUserProfile(userId);
  }

  @Get('me/stats')
  @ApiOperation({
    summary: 'Get counters for the mobile Profile screen stats strip',
    description:
      'Returns { storiesCompleted, hoursListened, voicesTrained }. hoursListened is a rough proxy (sum of READY Audio.duration), not real playback tracking.',
  })
  @ApiResponse({ status: 200, type: UserStatsDto })
  async getStats(@CurrentUser('id') userId: string): Promise<UserStatsDto> {
    return this.usersService.getStats(userId);
  }

  @Get('me/favorites')
  @ApiOperation({
    summary: 'Get the current user\'s favorite stories (alias for GET /stories/favorites)',
    description:
      'Semantically this belongs under /users/me — the existing /stories/favorites route stays for backwards compatibility.',
  })
  @ApiResponse({ status: 200, description: 'Favorites retrieved' })
  async getFavorites(
    @CurrentUser('id') userId: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.storiesService.getFavorites(
      userId,
      pagination.page || 1,
      pagination.limit || 20,
    );
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload user avatar' })
  @ApiResponse({ status: 200, description: 'Avatar uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async uploadAvatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    // Validate file
    if (!file) {
      throw new BadRequestException('errors.upload.noFile');
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException('errors.upload.avatarTooLarge');
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('errors.upload.avatarType');
    }

    return this.usersService.uploadAvatar(userId, file);
  }
}
