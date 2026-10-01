import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import SettingsPage from './settings-page';

describe('SettingsPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
