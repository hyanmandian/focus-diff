import { http } from '@/lib/http';
import type { ReadingGoal, Page } from '../types';

export const readingGoalsApi = {
  list: (params: { search?: string; page?: number }) => http.get<Page<ReadingGoal>>('/reading-goals', { params }),
  get: (id: string) => http.get<ReadingGoal>(`/reading-goals/${id}`),
  remove: (id: string) => http.delete(`/reading-goals/${id}`),
};
