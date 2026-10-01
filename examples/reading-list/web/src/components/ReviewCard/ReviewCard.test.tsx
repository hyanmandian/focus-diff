import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewCard } from './ReviewCard';

const review = { id: '1', name: 'Sample review', updatedAt: '2026-09-30T12:00:00Z' };

describe('ReviewCard', () => {
  it('renders the name as a heading', () => {
    render(<ReviewCard review={review} />);
    expect(screen.getByRole('heading', { name: 'Sample review' })).toBeInTheDocument();
  });

  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<ReviewCard review={review} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open review' }));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('hides the button without a handler', () => {
    render(<ReviewCard review={review} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
