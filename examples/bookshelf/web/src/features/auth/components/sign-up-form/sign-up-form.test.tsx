import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from './sign-up-form';

describe('SignUpForm', () => {
  it('renders', () => {
    render(<SignUpForm />);
    expect(screen.getByTestId('sign-up-form')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<SignUpForm onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<SignUpForm />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
