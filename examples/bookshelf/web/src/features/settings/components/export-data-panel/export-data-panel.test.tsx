import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportDataPanel } from './export-data-panel';

describe('ExportDataPanel', () => {
  it('renders', () => {
    render(<ExportDataPanel />);
    expect(screen.getByTestId('export-data-panel')).toBeInTheDocument();
  });

  it('calls onAction', async () => {
    const onAction = vi.fn();
    render(<ExportDataPanel onAction={onAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('omits the action without a handler', () => {
    render(<ExportDataPanel />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
