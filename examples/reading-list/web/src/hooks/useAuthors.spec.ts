import { renderHook, waitFor } from '@testing-library/react';
import { useAuthors } from './useAuthors';
import { createWrapper, mockApi } from '../test/utils';

describe('useAuthors', () => {
  it('loads authors', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Sample' }]);
    const { result } = renderHook(() => useAuthors(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the search term', async () => {
    mockApi.get.mockResolvedValue([]);
    renderHook(() => useAuthors('a&b'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/authors?search=a%26b'));
  });
});
