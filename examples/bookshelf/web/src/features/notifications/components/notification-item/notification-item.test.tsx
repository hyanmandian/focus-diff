import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationItem } from './notification-item';

describe('NotificationItem', () => {
  it('renders', () => {
    render(<NotificationItem />);
    expect(screen.getByTestId('notification-item')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<NotificationItem onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<NotificationItem />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
