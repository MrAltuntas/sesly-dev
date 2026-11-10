import { IsString, IsEnum, IsInt, Min, Max } from 'class-validator';

export enum GrantSubscriptionPlan {
    PRO = 'PRO',
    CREATOR = 'CREATOR',
    MINI = 'MINI',
}

export class GrantSubscriptionDto {
    @IsEnum(GrantSubscriptionPlan)
    plan: GrantSubscriptionPlan;

    @IsInt()
    @Min(1)
    @Max(3650)
    durationDays: number;

    @IsString()
    reason: string;
}
