import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFilters } from './search-filters';

describe('SearchFilters', () => {
  it('renders', () => {
    render(<SearchFilters />);
    expect(screen.getByTestId('search-filters')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<SearchFilters onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<SearchFilters />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
