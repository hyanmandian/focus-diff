import { http } from '@/lib/http';
import { authApi } from './auth-api';

vi.mock('@/lib/http');

describe('authApi', () => {
  it('passes params through', async () => {
    await authApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/auth', { params: { search: 'dune', page: 2 } });
  });
});
