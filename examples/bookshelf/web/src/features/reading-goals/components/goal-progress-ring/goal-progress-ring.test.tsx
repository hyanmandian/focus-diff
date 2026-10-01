import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalProgressRing } from './goal-progress-ring';

describe('GoalProgressRing', () => {
  it('renders', () => {
    render(<GoalProgressRing />);
    expect(screen.getByTestId('goal-progress-ring')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<GoalProgressRing onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<GoalProgressRing />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
