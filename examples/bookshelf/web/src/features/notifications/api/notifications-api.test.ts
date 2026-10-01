import { http } from '@/lib/http';
import { notificationsApi } from './notifications-api';

vi.mock('@/lib/http');

describe('notificationsApi', () => {
  it('passes params through', async () => {
    await notificationsApi.list({ search: 'dune', page: 2 });
    expect(http.get).toHaveBeenCalledWith('/notifications', { params: { search: 'dune', page: 2 } });
  });
});
