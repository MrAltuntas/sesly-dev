import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StorageService } from './storage.service';
import googleStorageConfig from '../../config/google-storage.config';

@Module({
  imports: [ConfigModule.forFeature(googleStorageConfig)],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}