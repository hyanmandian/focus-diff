import { http } from '@/lib/http';
import { settingsApi } from './settings-api';

vi.mock('@/lib/http');

describe('settingsApi', () => {
  it('passes params through', async () => {
    await settingsApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/settings', { params: { search: 'dune', page: 2 } });
  });
});
