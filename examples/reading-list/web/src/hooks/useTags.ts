import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag } from '../types';

export function useTags(search = '') {
  return useQuery({
    queryKey: ['tags', search],
    queryFn: () => api.get<Tag[]>(`/tags?search=${encodeURIComponent(search)}`),
    staleTime: 30_000,
  });
}
