import { Module } from '@nestjs/common';
import { PrismaModule } from '@prisma/prisma.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { StorageModule } from '@modules/storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
