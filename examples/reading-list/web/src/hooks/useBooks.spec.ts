import { renderHook, waitFor } from '@testing-library/react';
import { useBooks } from './useBooks';
import { createWrapper, mockApi } from '../test/utils';

describe('useBooks', () => {
  it('loads books', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Sample' }]);
    const { result } = renderHook(() => useBooks(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the search term', async () => {
    mockApi.get.mockResolvedValue([]);
    renderHook(() => useBooks('a&b'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/books?search=a%26b'));
  });
});
