import { PaginationQueryDto, paginate } from './pagination.dto';

const query = (page: number, limit: number): PaginationQueryDto =>
  Object.assign(new PaginationQueryDto(), { page, limit });

describe('PaginationQueryDto', () => {
  it('defaults to the first page of twenty', () => {
    const dto = new PaginationQueryDto();

    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
    expect(dto.skip).toBe(0);
  });

  it.each([
    [1, 20, 0],
    [2, 20, 20],
    [3, 5, 10],
    [10, 1, 9],
  ])('page %i of %i skips %i', (page, limit, expected) => {
    expect(query(page, limit).skip).toBe(expected);
  });
});

describe('paginate', () => {
  it('reports a single full page', () => {
    const { meta } = paginate([1, 2, 3], 3, query(1, 20));

    expect(meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1, hasNextPage: false });
  });

  it('rounds partial pages up', () => {
    expect(paginate([], 21, query(1, 20)).meta.totalPages).toBe(2);
    expect(paginate([], 40, query(1, 20)).meta.totalPages).toBe(2);
    expect(paginate([], 41, query(1, 20)).meta.totalPages).toBe(3);
  });

  it('flags a next page from anywhere but the last', () => {
    expect(paginate([], 25, query(1, 10)).meta.hasNextPage).toBe(true);
    expect(paginate([], 25, query(2, 10)).meta.hasNextPage).toBe(true);
    expect(paginate([], 25, query(3, 10)).meta.hasNextPage).toBe(false);
  });

  it('handles an empty result without claiming a page exists', () => {
    const { meta } = paginate([], 0, query(1, 20));

    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
  });

  it('reports no next page when asked for one past the end', () => {
    expect(paginate([], 5, query(99, 20)).meta.hasNextPage).toBe(false);
  });

  it('passes the rows through untouched', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];

    expect(paginate(rows, 2, query(1, 20)).data).toBe(rows);
  });
});
