import { renderHook, waitFor } from '@testing-library/react';
import { useTags } from './useTags';
import { createWrapper, mockApi } from '../test/utils';

describe('useTags', () => {
  it('loads tags', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Sample' }]);
    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the search term', async () => {
    mockApi.get.mockResolvedValue([]);
    renderHook(() => useTags('a&b'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/tags?search=a%26b'));
  });
});
