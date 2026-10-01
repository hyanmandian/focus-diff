import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../api/search-api';

export function useSearch(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['search', params],
    queryFn: () => searchApi.list(params),
    placeholderData: (previous) => previous,
  });
}
