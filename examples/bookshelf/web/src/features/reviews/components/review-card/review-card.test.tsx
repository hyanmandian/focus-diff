import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewCard } from './review-card';

describe('ReviewCard', () => {
  it('renders', () => {
    render(<ReviewCard />);
    expect(screen.getByTestId('review-card')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ReviewCard onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ReviewCard />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
