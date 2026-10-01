import { useQuery } from '@tanstack/react-query';
import { booksApi } from '../api/books-api';

export function useBooks(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['books', params],
    queryFn: () => booksApi.list(params),
    placeholderData: (previous) => previous,
  });
}
