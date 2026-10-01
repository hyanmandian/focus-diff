import { http } from '@/lib/http';
import type { Book, Page } from '../types';

export const booksApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<Book>>('/books', { params }),
  get: (id: string) => http.get<Book>(`/books/${id}`),
  remove: (id: string) => http.delete(`/books/${id}`),
};
