import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignInForm } from './sign-in-form';

describe('SignInForm', () => {
  it('renders', () => {
    render(<SignInForm />);
    expect(screen.getByTestId('sign-in-form')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<SignInForm onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<SignInForm />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
