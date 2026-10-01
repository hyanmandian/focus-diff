import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewList } from './review-list';

describe('ReviewList', () => {
  it('renders', () => {
    render(<ReviewList />);
    expect(screen.getByTestId('review-list')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ReviewList onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ReviewList />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
