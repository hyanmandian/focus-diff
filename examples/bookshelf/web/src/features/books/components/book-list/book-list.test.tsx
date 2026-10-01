import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookList } from './book-list';

describe('BookList', () => {
  it('renders', () => {
    render(<BookList />);
    expect(screen.getByTestId('book-list')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<BookList onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<BookList />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
