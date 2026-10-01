import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeSwitcher } from './theme-switcher';

describe('ThemeSwitcher', () => {
  it('renders', () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId('theme-switcher')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ThemeSwitcher onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ThemeSwitcher />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
