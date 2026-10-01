import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthorList } from './author-list';

describe('AuthorList', () => {
  it('renders', () => {
    render(<AuthorList />);
    expect(screen.getByTestId('author-list')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<AuthorList onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<AuthorList />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
