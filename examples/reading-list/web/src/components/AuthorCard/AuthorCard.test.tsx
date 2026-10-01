import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthorCard } from './AuthorCard';

const author = { id: '1', name: 'Sample author', updatedAt: '2026-09-30T12:00:00Z' };

describe('AuthorCard', () => {
  it('renders the name as a heading', () => {
    render(<AuthorCard author={author} />);
    expect(screen.getByRole('heading', { name: 'Sample author' })).toBeInTheDocument();
  });

  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<AuthorCard author={author} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open author' }));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('hides the button without a handler', () => {
    render(<AuthorCard author={author} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
