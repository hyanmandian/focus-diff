import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecentSearches } from './recent-searches';

describe('RecentSearches', () => {
  it('renders', () => {
    render(<RecentSearches />);
    expect(screen.getByTestId('recent-searches')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<RecentSearches onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<RecentSearches />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
