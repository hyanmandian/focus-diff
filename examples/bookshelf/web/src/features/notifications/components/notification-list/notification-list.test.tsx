import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationList } from './notification-list';

describe('NotificationList', () => {
  it('renders', () => {
    render(<NotificationList />);
    expect(screen.getByTestId('notification-list')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<NotificationList onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<NotificationList />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
