import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReaderCard } from './ReaderCard';

const reader = { id: '1', name: 'Sample reader', updatedAt: '2026-09-30T12:00:00Z' };

describe('ReaderCard', () => {
  it('renders the name as a heading', () => {
    render(<ReaderCard reader={reader} />);
    expect(screen.getByRole('heading', { name: 'Sample reader' })).toBeInTheDocument();
  });

  it('calls onSelect with the id', async () => {
    const onSelect = vi.fn();
    render(<ReaderCard reader={reader} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open reader' }));
    expect(onSelect).toHaveBeenCalledWith('1');
  });

  it('hides the button without a handler', () => {
    render(<ReaderCard reader={reader} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
