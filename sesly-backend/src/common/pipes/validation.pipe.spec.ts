import { ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { ValidationPipe } from './validation.pipe';

class CreateThingDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  count!: number;

  @IsOptional()
  @IsNotEmpty()
  note?: string;
}

const meta = (metatype?: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
  data: '',
});

describe('ValidationPipe (custom, src/common/pipes)', () => {
  const pipe = new ValidationPipe();

  it('passes the value through untouched when there is no metatype', async () => {
    const value = { anything: true };
    await expect(pipe.transform(value, meta(undefined))).resolves.toBe(value);
  });

  it.each([String, Boolean, Number, Array, Object])(
    'does not validate primitive / built-in metatype %p',
    async (metatype) => {
      const value = { not: 'validated' };
      await expect(pipe.transform(value, meta(metatype))).resolves.toBe(value);
    },
  );

  it('returns the ORIGINAL plain value (not a class instance) when valid', async () => {
    const value = { name: 'Keloglan', count: 2 };
    const result = await pipe.transform(value, meta(CreateThingDto));
    expect(result).toBe(value);
    expect(result).not.toBeInstanceOf(CreateThingDto);
  });

  it('does not strip or reject unknown properties (no whitelist)', async () => {
    const value = { name: 'Keloglan', count: 2, extra: 'kept' };
    await expect(pipe.transform(value, meta(CreateThingDto))).resolves.toEqual(value);
  });

  it('throws 400 with one message entry per invalid property', async () => {
    const err = await pipe
      .transform({ name: 42, count: 0 }, meta(CreateThingDto))
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    const messages = (err as BadRequestException).getResponse() as { message: string[] };
    expect(messages.message).toHaveLength(2);
    expect(messages.message[0]).toBe('name must be a string');
    expect(messages.message[1]).toBe('count must not be less than 1');
  });

  it('joins multiple constraint failures of one property with ", "', async () => {
    const err = (await pipe
      .transform({ name: 'x', count: 'abc' }, meta(CreateThingDto))
      .catch((e: unknown) => e)) as BadRequestException;
    const { message } = err.getResponse() as { message: string[] };
    expect(message).toHaveLength(1);
    expect(message[0].split(', ').sort()).toEqual(
      ['count must be an integer number', 'count must not be less than 1'].sort(),
    );
  });

  it('validates optional fields only when present', async () => {
    await expect(
      pipe.transform({ name: 'x', count: 1 }, meta(CreateThingDto)),
    ).resolves.toBeDefined();
    await expect(
      pipe.transform({ name: 'x', count: 1, note: '' }, meta(CreateThingDto)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
