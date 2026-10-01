import { http } from '@/lib/http';
import { shelvesApi } from './shelves-api';

vi.mock('@/lib/http');

describe('shelvesApi', () => {
  it('passes params through', async () => {
    await shelvesApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/shelves', { params: { search: 'dune', page: 2 } });
  });
});
