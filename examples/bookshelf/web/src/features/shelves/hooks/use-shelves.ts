import { useQuery } from '@tanstack/react-query';
import { shelvesApi } from '../api/shelves-api';

export function useShelves(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['shelves', params],
    queryFn: () => shelvesApi.list(params),
    placeholderData: (previous) => previous,
  });
}
