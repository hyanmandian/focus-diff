import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import ShelvesPage from './shelves-page';

describe('ShelvesPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<ShelvesPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
