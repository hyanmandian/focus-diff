import { http } from '@/lib/http';
import type { Review, Page } from '../types';

export const reviewsApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Review>>('/reviews', { params }),
  get: (id: string) => http.get<Review>(`/reviews/${id}`),
  remove: (id: string) => http.delete(`/reviews/${id}`),
};
