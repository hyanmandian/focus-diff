import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalCard } from './goal-card';

describe('GoalCard', () => {
  it('renders', () => {
    render(<GoalCard />);
    expect(screen.getByTestId('goal-card')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<GoalCard onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<GoalCard />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
