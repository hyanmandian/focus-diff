import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { booksApi } from '../api/books-api';
import { useBooks } from './use-books';

vi.mock('../api/books-api');

describe('useBooks', () => {
  it('requests the first page by default', async () => {
    vi.mocked(booksApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useBooks(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(booksApi.list).toHaveBeenCalledWith({}));
  });
});
