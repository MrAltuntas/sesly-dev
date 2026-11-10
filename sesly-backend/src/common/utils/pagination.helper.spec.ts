import { PaginationHelper } from './pagination.helper';

describe('PaginationHelper', () => {
  describe('createPaginatedResponse', () => {
    it('returns exactly the flat envelope clients parse', () => {
      const res = PaginationHelper.createPaginatedResponse(['a', 'b'], 42, 2, 20);
      expect(res).toEqual({ data: ['a', 'b'], total: 42, page: 2, limit: 20, totalPages: 3 });
      expect(Object.keys(res).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
    });

    it.each([
      [0, 20, 0],
      [1, 20, 1],
      [20, 20, 1],
      [21, 20, 2],
      [100, 100, 1],
    ])('total %i with limit %i -> %i pages', (total, limit, pages) => {
      expect(PaginationHelper.createPaginatedResponse([], total, 1, limit).totalPages).toBe(pages);
    });
  });

  describe('calculateOffset', () => {
    it.each([
      [1, 20, 0],
      [2, 20, 20],
      [5, 10, 40],
    ])('page %i limit %i -> skip %i', (page, limit, skip) => {
      expect(PaginationHelper.calculateOffset(page, limit)).toBe(skip);
    });
  });

  describe('normalizePaginationParams', () => {
    it('defaults to page 1 / limit 20', () => {
      expect(PaginationHelper.normalizePaginationParams()).toEqual({ page: 1, limit: 20 });
      expect(PaginationHelper.normalizePaginationParams(0, 0)).toEqual({ page: 1, limit: 20 });
    });

    it('clamps negatives and caps the limit at 100', () => {
      expect(PaginationHelper.normalizePaginationParams(-3, -5)).toEqual({ page: 1, limit: 1 });
      expect(PaginationHelper.normalizePaginationParams(4, 1000)).toEqual({ page: 4, limit: 100 });
    });
  });
});
