import { http } from '@/lib/http';
import type { Author, Page } from '../types';

export const authorsApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Author>>('/authors', { params }),
  get: (id: string) => http.get<Author>(`/authors/${id}`),
  remove: (id: string) => http.delete(`/authors/${id}`),
};
