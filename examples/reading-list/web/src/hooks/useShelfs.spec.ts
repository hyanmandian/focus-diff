import { renderHook, waitFor } from '@testing-library/react';
import { useShelfs } from './useShelfs';
import { createWrapper, mockApi } from '../test/utils';

describe('useShelfs', () => {
  it('loads shelfs', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Sample' }]);
    const { result } = renderHook(() => useShelfs(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('encodes the search term', async () => {
    mockApi.get.mockResolvedValue([]);
    renderHook(() => useShelfs('a&b'), { wrapper: createWrapper() });
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/shelfs?search=a%26b'));
  });
});
