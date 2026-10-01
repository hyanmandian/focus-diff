import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Shelf } from '../types';

export function useShelfs(search = '') {
  return useQuery({
    queryKey: ['shelfs', search],
    queryFn: () => api.get<Shelf[]>(`/shelfs?search=${encodeURIComponent(search)}`),
    staleTime: 30_000,
  });
}
