import { http } from '@/lib/http';
import { searchApi } from './search-api';

vi.mock('@/lib/http');

describe('searchApi', () => {
  it('passes params through', async () => {
    await searchApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/search', { params: { search: 'dune', page: 2 } });
  });
});
