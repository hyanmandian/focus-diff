import { http } from '@/lib/http';
import type { Notification, Page } from '../types';

export const notificationsApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Notification>>('/notifications', { params }),
  get: (id: string) => http.get<Notification>(`/notifications/${id}`),
  remove: (id: string) => http.delete(`/notifications/${id}`),
};
