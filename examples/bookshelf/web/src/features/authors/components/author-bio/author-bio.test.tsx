import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthorBio } from './author-bio';

describe('AuthorBio', () => {
  it('renders', () => {
    render(<AuthorBio />);
    expect(screen.getByTestId('author-bio')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<AuthorBio onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<AuthorBio />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
