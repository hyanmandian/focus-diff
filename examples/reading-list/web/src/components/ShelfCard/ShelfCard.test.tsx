import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShelfCard } from './ShelfCard';

const shelf = { id: '1', name: 'Sample shelf', updatedAt: '2026-09-30T12:00:00Z' };

describe('ShelfCard', () => {
  it('renders the name as a heading', () => {
    render(<ShelfCard shelf={shelf} />);
    expect(screen.getByRole('heading', { name: 'Sample shelf' })).toBeInTheDocument();
  });

  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<ShelfCard shelf={shelf} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open shelf' }));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('hides the button without a handler', () => {
    render(<ShelfCard shelf={shelf} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
