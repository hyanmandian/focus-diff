import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagCard } from './TagCard';

const tag = { id: '1', name: 'Sample tag', updatedAt: '2026-09-30T12:00:00Z' };

describe('TagCard', () => {
  it('renders the name as a heading', () => {
    render(<TagCard tag={tag} />);
    expect(screen.getByRole('heading', { name: 'Sample tag' })).toBeInTheDocument();
  });

  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<TagCard tag={tag} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open tag' }));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('hides the button without a handler', () => {
    render(<TagCard tag={tag} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
