import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import AuthorsPage from './authors-page';

describe('AuthorsPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<AuthorsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
