import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import NotificationsPage from './notifications-page';

describe('NotificationsPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<NotificationsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
