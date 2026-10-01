import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from './search-bar';

describe('SearchBar', () => {
  it('renders', () => {
    render(<SearchBar />);
    expect(screen.getByTestId('search-bar')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<SearchBar onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<SearchBar />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
