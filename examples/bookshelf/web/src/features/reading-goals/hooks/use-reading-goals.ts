import { useQuery } from '@tanstack/react-query';
import { readingGoalsApi } from '../api/reading-goals-api';

export function useReadingGoals(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['reading-goals', params],
    queryFn: () => readingGoalsApi.list(params),
    placeholderData: (previous) => previous,
  });
}
