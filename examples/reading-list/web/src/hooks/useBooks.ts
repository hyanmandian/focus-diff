import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Book } from '../types';

export function useBooks(search = '') {
  return useQuery({
    queryKey: ['books', search],
    queryFn: () => api.get<Book[]>(`/books?search=${encodeURIComponent(search)}`),
    staleTime: 30_000,
  });
}
