import { render } from '@testing-library/react';
import { ErrorBoundary } from './error-boundary';

it('forwards props', () => {
  const { container } = render(<ErrorBoundary aria-label="error-boundary" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'error-boundary');
});
