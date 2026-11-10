import { IsString, IsEnum } from 'class-validator';

export enum BroadcastSegment {
    ALL = 'ALL',
    PREMIUM = 'PREMIUM',
    FREE = 'FREE',
}

export class BroadcastDto {
    @IsString()
    title: string;

    @IsString()
    body: string;

    @IsEnum(BroadcastSegment)
    segment: BroadcastSegment;
}
