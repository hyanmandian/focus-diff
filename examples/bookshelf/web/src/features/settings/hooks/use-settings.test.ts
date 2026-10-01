import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { settingsApi } from '../api/settings-api';
import { useSettings } from './use-settings';

vi.mock('../api/settings-api');

describe('useSettings', () => {
  it('requests the first page by default', async () => {
    vi.mocked(settingsApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useSettings(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(settingsApi.list).toHaveBeenCalledWith({}));
  });
});
