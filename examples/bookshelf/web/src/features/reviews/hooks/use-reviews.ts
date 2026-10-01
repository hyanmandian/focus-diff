import { useQuery } from '@tanstack/react-query';
import { reviewsApi } from '../api/reviews-api';

export function useReviews(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['reviews', params],
    queryFn: () => reviewsApi.list(params),
    placeholderData: (previous) => previous,
  });
}
