import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivacySettings } from './privacy-settings';

describe('PrivacySettings', () => {
  it('renders', () => {
    render(<PrivacySettings />);
    expect(screen.getByTestId('privacy-settings')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<PrivacySettings onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<PrivacySettings />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
