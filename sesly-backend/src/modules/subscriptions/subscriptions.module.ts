import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { UsageModule } from '../usage/usage.module';
import { PrismaModule } from '../../prisma/prisma.module';
import storeConfig from '../../config/store.config';
import { StorePurchasesService } from './store/store-purchases.service';
import { GooglePlayClient } from './store/google-play.client';
import { GooglePlayService } from './store/google-play.service';
import { AppStoreClient } from './store/app-store.client';
import { AppStoreService } from './store/app-store.service';

@Module({
  imports: [ConfigModule.forFeature(storeConfig), UsageModule, PrismaModule],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    StorePurchasesService,
    GooglePlayClient,
    GooglePlayService,
    AppStoreClient,
    AppStoreService,
  ],
  exports: [SubscriptionsService, StorePurchasesService, GooglePlayService, AppStoreService],
})
export class SubscriptionsModule {}
