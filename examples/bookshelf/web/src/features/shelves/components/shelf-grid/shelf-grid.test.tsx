import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShelfGrid } from './shelf-grid';

describe('ShelfGrid', () => {
  it('renders', () => {
    render(<ShelfGrid />);
    expect(screen.getByTestId('shelf-grid')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ShelfGrid onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ShelfGrid />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
