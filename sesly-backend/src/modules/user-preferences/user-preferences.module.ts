import { Module } from '@nestjs/common';
import { PrismaModule } from '@prisma/prisma.module';
import { UserPreferencesController } from './user-preferences.controller';
import { UserPreferencesService } from './user-preferences.service';

@Module({
  imports: [PrismaModule],
  controllers: [UserPreferencesController],
  providers: [UserPreferencesService],
  exports: [UserPreferencesService],
})
export class UserPreferencesModule {}
