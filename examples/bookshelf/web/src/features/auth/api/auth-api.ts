import { http } from '@/lib/http';
import type { Session, Page } from '../types';

export const authApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Session>>('/auth', { params }),
  get: (id: string) => http.get<Session>(`/auth/${id}`),
  remove: (id: string) => http.delete(`/auth/${id}`),
};
