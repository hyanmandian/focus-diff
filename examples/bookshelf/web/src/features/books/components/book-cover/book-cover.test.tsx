import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookCover } from './book-cover';

describe('BookCover', () => {
  it('renders', () => {
    render(<BookCover />);
    expect(screen.getByTestId('book-cover')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<BookCover onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<BookCover />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
