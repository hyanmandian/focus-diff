import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { shelvesApi } from '../api/shelves-api';
import { useShelves } from './use-shelves';

vi.mock('../api/shelves-api');

describe('useShelves', () => {
  it('requests the first page by default', async () => {
    vi.mocked(shelvesApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useShelves(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(shelvesApi.list).toHaveBeenCalledWith({}));
  });
});
