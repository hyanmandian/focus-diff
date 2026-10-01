import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Author } from '../types';

export function useAuthors(search = '') {
  return useQuery({
    queryKey: ['authors', search],
    queryFn: () => api.get<Author[]>(`/authors?search=${encodeURIComponent(search)}`),
    staleTime: 30_000,
  });
}
