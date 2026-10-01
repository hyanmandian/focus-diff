import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../api/settings-api';

export function useSettings(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['settings', params],
    queryFn: () => settingsApi.list(params),
    placeholderData: (previous) => previous,
  });
}
