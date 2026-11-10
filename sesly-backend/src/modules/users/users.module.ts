import { Module, forwardRef } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StorageModule } from '../storage/storage.module';
import { TTSProvidersModule } from '../tts-providers/tts-providers.module';
import { StoriesModule } from '../stories/stories.module';

@Module({
  imports: [
    StorageModule,
    TTSProvidersModule,
    forwardRef(() => StoriesModule),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
