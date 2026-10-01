import { createBrowserRouter } from 'react-router-dom';

export const router = createBrowserRouter([
  { path: '/books', lazy: () => import('../features/books/books-page') },
  { path: '/authors', lazy: () => import('../features/authors/authors-page') },
  { path: '/shelves', lazy: () => import('../features/shelves/shelves-page') },
  { path: '/reviews', lazy: () => import('../features/reviews/reviews-page') },
  { path: '/search', lazy: () => import('../features/search/search-page') },
  { path: '/reading-goals', lazy: () => import('../features/reading-goals/reading-goals-page') },
  { path: '/notifications', lazy: () => import('../features/notifications/notifications-page') },
  { path: '/settings', lazy: () => import('../features/settings/settings-page') },
  { path: '/auth', lazy: () => import('../features/auth/auth-page') },
]);
