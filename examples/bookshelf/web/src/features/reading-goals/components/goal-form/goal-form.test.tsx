import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoalForm } from './goal-form';

describe('GoalForm', () => {
  it('renders', () => {
    render(<GoalForm />);
    expect(screen.getByTestId('goal-form')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<GoalForm onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<GoalForm />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
