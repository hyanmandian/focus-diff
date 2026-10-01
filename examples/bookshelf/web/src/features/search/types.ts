export type SearchResult = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = { items: T[]; total: number };
