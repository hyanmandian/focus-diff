import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Reader } from '../types';

export function useReaders(search = '') {
  return useQuery({
    queryKey: ['readers', search],
    queryFn: () => api.get<Reader[]>(`/readers?search=${encodeURIComponent(search)}`),
    staleTime: 30_000,
  });
}
