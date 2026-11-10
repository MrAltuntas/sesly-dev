-- Turkish-aware, accent- and case-insensitive search.
-- ILIKE does not fold ı/İ, ş, ğ, ü, ö, ç, so "yildiz" or "YILDIZ" never found
-- "Yıldız". sesly_search_fold() strips combining accents (NFD), maps ı and I
-- to i (so the result does not depend on a Turkish collation) and lowercases.
-- Search compares sesly_search_fold(column) with sesly_search_fold(term).

-- CreateFunction
CREATE OR REPLACE FUNCTION sesly_search_fold(input TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT lower(translate(regexp_replace(normalize(input, NFD), '[̀-ͯ]', '', 'g'), 'ıI', 'ii'))
$$;

-- AlterTable: folded title and content, kept in sync by Postgres. Prisma
-- never reads or writes it (@ignore); story search matches against it.
ALTER TABLE "stories" ADD COLUMN "searchText" TEXT GENERATED ALWAYS AS (sesly_search_fold("title" || E'\n' || "content")) STORED;
