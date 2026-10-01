import { http } from '@/lib/http';
import { booksApi } from './books-api';

vi.mock('@/lib/http');

describe('booksApi', () => {
  it('passes params through', async () => {
    await booksApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/books', { params: { search: 'dune', page: 2 } });
  });
});
