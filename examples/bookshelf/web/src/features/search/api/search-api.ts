import { http } from '@/lib/http';
import type { SearchResult, Page } from '../types';

export const searchApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<SearchResult>>('/search', { params }),
  get: (id: string) => http.get<SearchResult>(`/search/${id}`),
  remove: (id: string) => http.delete(`/search/${id}`),
};
