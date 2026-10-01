import { http } from '@/lib/http';
import { reviewsApi } from './reviews-api';

vi.mock('@/lib/http');

describe('reviewsApi', () => {
  it('passes params through', async () => {
    await reviewsApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/reviews', { params: { search: 'dune', page: 2 } });
  });
});
