export type Notification = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = { items: T[]; total: number };
