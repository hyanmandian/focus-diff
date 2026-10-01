import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { authApi } from '../api/auth-api';
import { useAuth } from './use-auth';

vi.mock('../api/auth-api');

describe('useAuth', () => {
  it('requests the first page by default', async () => {
    vi.mocked(authApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useAuth(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(authApi.list).toHaveBeenCalledWith({}));
  });
});
