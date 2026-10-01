import { http } from '@/lib/http';
import { authorsApi } from './authors-api';

vi.mock('@/lib/http');

describe('authorsApi', () => {
  it('passes params through', async () => {
    await authorsApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/authors', { params: { search: 'dune', page: 2 } });
  });
});
