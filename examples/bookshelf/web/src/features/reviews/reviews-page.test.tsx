import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import ReviewsPage from './reviews-page';

describe('ReviewsPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<ReviewsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
