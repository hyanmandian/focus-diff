import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShelfPicker } from './shelf-picker';

describe('ShelfPicker', () => {
  it('renders', () => {
    render(<ShelfPicker />);
    expect(screen.getByTestId('shelf-picker')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ShelfPicker onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ShelfPicker />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
