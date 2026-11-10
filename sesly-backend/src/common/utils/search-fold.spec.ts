import {
  escapeLikePattern,
  foldedContainsPattern,
  narrationSearchIdsQuery,
  normalizeSearchTerm,
  storySearchIdsQuery,
} from './search-fold';

/** Postgres SQL text ($n placeholders), whitespace collapsed. */
const sqlText = (q: { text: string }) => q.text.replace(/\s+/g, ' ').trim();

describe('search-fold', () => {
  describe('normalizeSearchTerm', () => {
    it('trims the term and keeps its letters as typed (folding happens in SQL)', () => {
      expect(normalizeSearchTerm('  Küçük Yıldız ')).toBe('Küçük Yıldız');
      expect(normalizeSearchTerm('yildiz')).toBe('yildiz');
    });

    it('nothing left to search for is null', () => {
      expect(normalizeSearchTerm(undefined)).toBeNull();
      expect(normalizeSearchTerm(null)).toBeNull();
      expect(normalizeSearchTerm('')).toBeNull();
      expect(normalizeSearchTerm(' \t\n ')).toBeNull();
    });
  });

  describe('escapeLikePattern', () => {
    it('escapes %, _ and the backslash so they match literally', () => {
      expect(escapeLikePattern('100%')).toBe('100\\%');
      expect(escapeLikePattern('a_b')).toBe('a\\_b');
      expect(escapeLikePattern('c:\\x')).toBe('c:\\\\x');
      expect(escapeLikePattern('%_%')).toBe('\\%\\_\\%');
    });

    it('leaves ordinary and Turkish letters alone', () => {
      expect(escapeLikePattern('Keloğlan ile İnci')).toBe('Keloğlan ile İnci');
    });
  });

  describe('foldedContainsPattern', () => {
    it('folds the escaped term in SQL and wraps it in % wildcards', () => {
      const q = foldedContainsPattern('50%');
      expect(sqlText(q)).toBe("('%' || sesly_search_fold($1) || '%')");
      expect(q.values).toEqual(['50\\%']);
    });
  });

  describe('storySearchIdsQuery', () => {
    it('matches the folded searchText column of published stories', () => {
      const q = storySearchIdsQuery('YILDIZ');
      expect(sqlText(q)).toBe(
        `SELECT s."id" FROM "stories" s WHERE s."status" = 'PUBLISHED' ` +
          `AND s."searchText" LIKE ('%' || sesly_search_fold($1) || '%')`,
      );
      expect(q.values).toEqual(['YILDIZ']);
    });

    it('keeps an injection attempt in the bound values, never in the SQL text', () => {
      const attack = "x'; DROP TABLE stories; --";
      const q = storySearchIdsQuery(attack);
      expect(q.text).not.toContain('DROP');
      expect(q.values).toEqual([attack]);
    });
  });

  describe('narrationSearchIdsQuery', () => {
    it("scopes to the user and folds the narration title and the story title", () => {
      const q = narrationSearchIdsQuery('user-1', 'kucuk');
      expect(sqlText(q)).toBe(
        'SELECT n."id" FROM "story_narrations" n JOIN "stories" s ON s."id" = n."storyId" ' +
          'WHERE n."userId" = $1 ' +
          `AND (sesly_search_fold(n."title") LIKE ('%' || sesly_search_fold($2) || '%') ` +
          `OR sesly_search_fold(s."title") LIKE ('%' || sesly_search_fold($3) || '%'))`,
      );
      expect(q.values).toEqual(['user-1', 'kucuk', 'kucuk']);
    });

    it('binds both the user id and the term', () => {
      const q = narrationSearchIdsQuery("u' OR '1'='1", '%');
      expect(q.text).not.toContain("'1'='1");
      expect(q.values).toEqual(["u' OR '1'='1", '\\%', '\\%']);
    });
  });
});
