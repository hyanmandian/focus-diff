import { useQuery } from '@tanstack/react-query';
import { notificationsApi } from '../api/notifications-api';

export function useNotifications(params: { search?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['notifications', params],
    queryFn: () => notificationsApi.list(params),
    placeholderData: (previous) => previous,
  });
}
