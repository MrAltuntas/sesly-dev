import { Module } from '@nestjs/common';
import { PrismaModule } from '@prisma/prisma.module';
import { LegalDocumentsController } from './legal-documents.controller';
import { LegalDocumentsService } from './legal-documents.service';
import { LegalDocumentsSeeder } from './legal-documents.seeder';

@Module({
  imports: [PrismaModule],
  controllers: [LegalDocumentsController],
  providers: [LegalDocumentsService, LegalDocumentsSeeder],
  exports: [LegalDocumentsService],
})
export class LegalDocumentsModule {}
