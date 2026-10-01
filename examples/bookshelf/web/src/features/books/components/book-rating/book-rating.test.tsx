import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookRating } from './book-rating';

describe('BookRating', () => {
  it('renders', () => {
    render(<BookRating />);
    expect(screen.getByTestId('book-rating')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<BookRating onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<BookRating />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
