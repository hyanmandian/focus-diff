import { useQuery } from '@tanstack/react-query';
import { authApi } from '../api/auth-api';

export function useAuth(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['auth', params],
    queryFn: () => authApi.list(params),
    placeholderData: (previous) => previous,
  });
}
