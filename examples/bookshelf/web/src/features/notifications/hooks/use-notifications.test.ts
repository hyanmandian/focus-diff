import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { notificationsApi } from '../api/notifications-api';
import { useNotifications } from './use-notifications';

vi.mock('../api/notifications-api');

describe('useNotifications', () => {
  it('requests the first page by default', async () => {
    vi.mocked(notificationsApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useNotifications(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(notificationsApi.list).toHaveBeenCalledWith({}));
  });
});
