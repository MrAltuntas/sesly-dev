import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminLegalListQueryDto, LegalLanguageQueryDto } from './legal-language-query.dto';
import { CreateLegalDocumentDto } from './create-legal-document.dto';
import { UpdateLegalDocumentDto } from './update-legal-document.dto';
import {
  ADMIN_LEGAL_LIST_LANGUAGE_MESSAGE,
  LEGAL_DOCUMENT_LANGUAGE_MESSAGE,
} from '../legal-languages';

/** Same options as the global ValidationPipe in main.ts. */
async function check<T extends object>(cls: new () => T, plain: Record<string, any>) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return {
    instance,
    invalid: errors.map((e) => e.property),
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

/** No emoji, no em-dash, no arrows or decorative glyphs in anything the panel shows. */
const CLEAN_COPY = /^[\p{L}\p{N} _,.:;()"'\-*?/]+$/u;

describe('legal document DTOs', () => {
  describe('LegalLanguageQueryDto (public reads and per-document admin routes)', () => {
    it.each([
      [{}, undefined],
      [{ language: 'tr' }, 'tr'],
      [{ language: 'en' }, 'en'],
      [{ language: 'EN' }, 'en'],
      [{ language: 'en-GB' }, 'en'],
      [{ language: 'tr_TR' }, 'tr'],
      [{ language: '' }, undefined],
    ])('%p is valid and read as %p', async (plain, expected) => {
      const res = await check(LegalLanguageQueryDto, plain);
      expect(res.invalid).toEqual([]);
      expect(res.instance.language).toBe(expected);
    });

    it.each(['de', 'all', 'turkish', 'x'])('language=%p is rejected with the Turkish message', async (bad) => {
      const res = await check(LegalLanguageQueryDto, { language: bad });
      expect(res.invalid).toEqual(['language']);
      expect(res.messages).toEqual([LEGAL_DOCUMENT_LANGUAGE_MESSAGE]);
    });

    it('an array (repeated parameter) is rejected', async () => {
      const res = await check(LegalLanguageQueryDto, { language: ['en', 'tr'] });
      expect(res.invalid).toEqual(['language']);
    });
  });

  describe('AdminLegalListQueryDto (GET /admin/legal)', () => {
    it.each([
      [{}, undefined],
      [{ language: 'tr' }, 'tr'],
      [{ language: 'en' }, 'en'],
      [{ language: 'all' }, 'all'],
      [{ language: 'ALL' }, 'all'],
    ])('%p is valid and read as %p', async (plain, expected) => {
      const res = await check(AdminLegalListQueryDto, plain);
      expect(res.invalid).toEqual([]);
      expect(res.instance.language).toBe(expected);
    });

    it('an unknown language is rejected', async () => {
      const res = await check(AdminLegalListQueryDto, { language: 'de' });
      expect(res.invalid).toEqual(['language']);
      expect(res.messages).toEqual([ADMIN_LEGAL_LIST_LANGUAGE_MESSAGE]);
    });
  });

  describe('CreateLegalDocumentDto', () => {
    const base = { slug: 'tos', title: 'Terms of Use', contentMd: 'Body' };

    it('language is optional (the panel sends none today) and accepts tr / en', async () => {
      expect((await check(CreateLegalDocumentDto, base)).invalid).toEqual([]);
      const en = await check(CreateLegalDocumentDto, { ...base, language: 'EN' });
      expect(en.invalid).toEqual([]);
      expect(en.instance.language).toBe('en');
    });

    it('an unknown language is rejected', async () => {
      const res = await check(CreateLegalDocumentDto, { ...base, language: 'fr' });
      expect(res.invalid).toEqual(['language']);
      expect(res.messages).toEqual([LEGAL_DOCUMENT_LANGUAGE_MESSAGE]);
    });
  });

  describe('UpdateLegalDocumentDto', () => {
    it('accepts title and contentMd', async () => {
      expect((await check(UpdateLegalDocumentDto, { title: 'T', contentMd: 'C' })).invalid).toEqual([]);
      expect((await check(UpdateLegalDocumentDto, {})).invalid).toEqual([]);
    });

    it.each([{ language: 'en' }, { slug: 'privacy' }])(
      '%p in the body is rejected: slug and language identify the document and never change',
      async (plain) => {
        const res = await check(UpdateLegalDocumentDto, plain);
        expect(res.invalid).toEqual(Object.keys(plain));
      },
    );
  });

  it('the validation messages follow the UI text rules', () => {
    for (const message of [LEGAL_DOCUMENT_LANGUAGE_MESSAGE, ADMIN_LEGAL_LIST_LANGUAGE_MESSAGE]) {
      expect(message).toMatch(CLEAN_COPY);
    }
  });
});
