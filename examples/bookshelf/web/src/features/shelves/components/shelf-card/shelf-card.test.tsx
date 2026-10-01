import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShelfCard } from './shelf-card';

describe('ShelfCard', () => {
  it('renders', () => {
    render(<ShelfCard />);
    expect(screen.getByTestId('shelf-card')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ShelfCard onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ShelfCard />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
