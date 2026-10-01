import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookDetails } from './book-details';

describe('BookDetails', () => {
  it('renders', () => {
    render(<BookDetails />);
    expect(screen.getByTestId('book-details')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<BookDetails onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<BookDetails />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
