import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookProgress } from './book-progress';

describe('BookProgress', () => {
  it('renders', () => {
    render(<BookProgress />);
    expect(screen.getByTestId('book-progress')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<BookProgress onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<BookProgress />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
