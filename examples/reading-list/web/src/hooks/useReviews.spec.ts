import { renderHook, waitFor } from '@testing-library/react';
import { useReviews } from './useReviews';
import { createWrapper, mockApi } from '../test/utils';

describe('useReviews', () => {
  it('loads reviews', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Sample' }]);
    const { result } = renderHook(() => useReviews(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the search term', async () => {
    mockApi.get.mockResolvedValue([]);
    renderHook(() => useReviews('a&b'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/reviews?search=a%26b'));
  });
});
