import { IsString, IsEnum, IsInt, IsEmail } from 'class-validator';

export enum AdminSubscriptionPlan {
    PRO = 'PRO',
    CREATOR = 'CREATOR',
    MINI = 'MINI',
}

export class GrantAccessDto {
    @IsEmail()
    userEmail: string;

    @IsEnum(AdminSubscriptionPlan)
    plan: AdminSubscriptionPlan;

    @IsInt()
    durationDays: number;

    @IsString()
    reason: string;
}
