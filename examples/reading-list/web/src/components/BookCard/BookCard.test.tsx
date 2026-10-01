import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookCard } from './BookCard';

const book = { id: '1', name: 'Sample book', updatedAt: '2026-09-30T12:00:00Z' };

describe('BookCard', () => {
  it('renders the name as a heading', () => {
    render(<BookCard book={book} />);
    expect(screen.getByRole('heading', { name: 'Sample book' })).toBeInTheDocument();
  });

  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<BookCard book={book} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open book' }));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('hides the button without a handler', () => {
    render(<BookCard book={book} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
