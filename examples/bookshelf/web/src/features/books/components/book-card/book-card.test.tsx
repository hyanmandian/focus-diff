import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookCard } from './book-card';

describe('BookCard', () => {
  it('renders', () => {
    render(<BookCard />);
    expect(screen.getByTestId('book-card')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<BookCard onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<BookCard />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
