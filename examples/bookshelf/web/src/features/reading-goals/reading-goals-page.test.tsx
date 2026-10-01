import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import ReadingGoalsPage from './reading-goals-page';

describe('ReadingGoalsPage', () => {
  it('shows a loading state first', () => {
    renderWithProviders(<ReadingGoalsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
