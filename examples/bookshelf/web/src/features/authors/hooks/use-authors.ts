import { useQuery } from '@tanstack/react-query';
import { authorsApi } from '../api/authors-api';

export function useAuthors(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['authors', params],
    queryFn: () => authorsApi.list(params),
    placeholderData: (previous) => previous,
  });
}
