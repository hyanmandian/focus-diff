import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { searchApi } from '../api/search-api';
import { useSearch } from './use-search';

vi.mock('../api/search-api');

describe('useSearch', () => {
  it('requests the first page by default', async () => {
    vi.mocked(searchApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useSearch(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(searchApi.list).toHaveBeenCalledWith({}));
  });
});
