import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateShelfDialog } from './create-shelf-dialog';

describe('CreateShelfDialog', () => {
  it('renders', () => {
    render(<CreateShelfDialog />);
    expect(screen.getByTestId('create-shelf-dialog')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<CreateShelfDialog onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<CreateShelfDialog />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
