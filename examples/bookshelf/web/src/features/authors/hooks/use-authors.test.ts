import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { authorsApi } from '../api/authors-api';
import { useAuthors } from './use-authors';

vi.mock('../api/authors-api');

describe('useAuthors', () => {
  it('requests the first page by default', async () => {
    vi.mocked(authorsApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useAuthors(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(authorsApi.list).toHaveBeenCalledWith({}));
  });
});
