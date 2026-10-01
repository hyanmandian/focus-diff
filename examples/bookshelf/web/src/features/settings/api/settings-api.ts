import { http } from '@/lib/http';
import type { Preference, Page } from '../types';

export const settingsApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Preference>>('/settings', { params }),
  get: (id: string) => http.get<Preference>(`/settings/${id}`),
  remove: (id: string) => http.delete(`/settings/${id}`),
};
