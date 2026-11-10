import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentAdmin = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const admin = request.user; // Passport attaches admin to request.user

    return data ? admin?.[data] : admin;
  },
);
