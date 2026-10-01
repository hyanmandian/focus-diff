import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import BooksPage from './books-page';

describe('BooksPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<BooksPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
