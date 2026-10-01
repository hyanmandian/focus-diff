import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { readingGoalsApi } from '../api/reading-goals-api';
import { useReadingGoals } from './use-reading-goals';

vi.mock('../api/reading-goals-api');

describe('useReadingGoals', () => {
  it('requests the first page by default', async () => {
    vi.mocked(readingGoalsApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useReadingGoals(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(readingGoalsApi.list).toHaveBeenCalledWith({}));
  });
});
