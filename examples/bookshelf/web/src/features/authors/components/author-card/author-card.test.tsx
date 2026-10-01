import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthorCard } from './author-card';

describe('AuthorCard', () => {
  it('renders', () => {
    render(<AuthorCard />);
    expect(screen.getByTestId('author-card')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<AuthorCard onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<AuthorCard />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
