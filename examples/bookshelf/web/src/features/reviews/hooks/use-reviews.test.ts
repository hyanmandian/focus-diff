import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/query-wrapper';
import { reviewsApi } from '../api/reviews-api';
import { useReviews } from './use-reviews';

vi.mock('../api/reviews-api');

describe('useReviews', () => {
  it('requests the first page by default', async () => {
    vi.mocked(reviewsApi.list).mockResolvedValue({ items: [], total: 0 });
    renderHook(() => useReviews(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(reviewsApi.list).toHaveBeenCalledWith({}));
  });
});
