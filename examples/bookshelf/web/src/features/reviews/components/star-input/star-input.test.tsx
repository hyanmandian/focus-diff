import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StarInput } from './star-input';

describe('StarInput', () => {
  it('renders', () => {
    render(<StarInput />);
    expect(screen.getByTestId('star-input')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<StarInput onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<StarInput />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
