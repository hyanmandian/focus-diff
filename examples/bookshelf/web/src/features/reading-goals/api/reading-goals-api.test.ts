import { http } from '@/lib/http';
import { readingGoalsApi } from './reading-goals-api';

vi.mock('@/lib/http');

describe('readingGoalsApi', () => {
  it('passes params through', async () => {
    await readingGoalsApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/reading-goals', { params: { search: 'dune', page: 2 } });
  });
});
