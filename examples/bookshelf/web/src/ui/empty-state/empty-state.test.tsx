import { render } from '@testing-library/react';
import { EmptyState } from './empty-state';

it('forwards props', () => {
  const { container } = render(<EmptyState aria-label="empty-state" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'empty-state');
});
