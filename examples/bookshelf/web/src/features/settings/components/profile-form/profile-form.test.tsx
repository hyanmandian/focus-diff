import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from './profile-form';

describe('ProfileForm', () => {
  it('renders', () => {
    render(<ProfileForm />);
    expect(screen.getByTestId('profile-form')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ProfileForm onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ProfileForm />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
