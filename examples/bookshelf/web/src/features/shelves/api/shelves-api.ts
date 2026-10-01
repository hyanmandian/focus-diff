import { http } from '@/lib/http';
import type { Shelf, Page } from '../types';

export const shelvesApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Shelf>>('/shelves', { params }),
  get: (id: string) => http.get<Shelf>(`/shelves/${id}`),
  remove: (id: string) => http.delete(`/shelves/${id}`),
};
