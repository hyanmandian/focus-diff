import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell } from './notification-bell';

describe('NotificationBell', () => {
  it('renders', () => {
    render(<NotificationBell />);
    expect(screen.getByTestId('notification-bell')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<NotificationBell onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<NotificationBell />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
