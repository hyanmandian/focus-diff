import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import SearchPage from './search-page';

describe('SearchPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<SearchPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
