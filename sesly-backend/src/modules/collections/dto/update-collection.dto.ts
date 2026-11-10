import { PartialType } from '@nestjs/swagger';
import { CreateCollectionDto } from './create-collection.dto';

/**
 * All CreateCollectionDto fields become optional for PATCH.
 */
export class UpdateCollectionDto extends PartialType(CreateCollectionDto) {}
