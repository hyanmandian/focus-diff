import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchResults } from './search-results';

describe('SearchResults', () => {
  it('renders', () => {
    render(<SearchResults />);
    expect(screen.getByTestId('search-results')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<SearchResults onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<SearchResults />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
