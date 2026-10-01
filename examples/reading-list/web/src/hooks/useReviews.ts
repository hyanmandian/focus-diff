import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Review } from '../types';

export function useReviews(search = '') {
  return useQuery({
    queryKey: ['reviews', search],
    queryFn: () => api.get<Review[]>(`/reviews?search=${encodeURIComponent(search)}`),
    staleTime: 30_000,
  });
}
