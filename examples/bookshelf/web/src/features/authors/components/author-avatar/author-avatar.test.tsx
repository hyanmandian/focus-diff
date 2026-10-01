import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthorAvatar } from './author-avatar';

describe('AuthorAvatar', () => {
  it('renders', () => {
    render(<AuthorAvatar />);
    expect(screen.getByTestId('author-avatar')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<AuthorAvatar onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<AuthorAvatar />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
