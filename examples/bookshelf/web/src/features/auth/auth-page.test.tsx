import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import AuthPage from './auth-page';

describe('AuthPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<AuthPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
