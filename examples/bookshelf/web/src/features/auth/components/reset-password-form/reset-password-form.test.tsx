import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordForm } from './reset-password-form';

describe('ResetPasswordForm', () => {
  it('renders', () => {
    render(<ResetPasswordForm />);
    expect(screen.getByTestId('reset-password-form')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ResetPasswordForm onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ResetPasswordForm />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
