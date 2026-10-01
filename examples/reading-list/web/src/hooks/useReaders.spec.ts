import { renderHook, waitFor } from '@testing-library/react';
import { useReaders } from './useReaders';
import { createWrapper, mockApi } from '../test/utils';

describe('useReaders', () => {
  it('loads readers', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Sample' }]);
    const { result } = renderHook(() => useReaders(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the search term', async () => {
    mockApi.get.mockResolvedValue([]);
    renderHook(() => useReaders('a&b'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/readers?search=a%26b'));
  });
});
