import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewForm } from './review-form';

describe('ReviewForm', () => {
  it('renders', () => {
    render(<ReviewForm />);
    expect(screen.getByTestId('review-form')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ReviewForm onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ReviewForm />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
