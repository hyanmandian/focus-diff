import { render } from '@testing-library/react';
import { Badge } from './badge';

it('forwards props', () => {
  const { container } = render(<Badge aria-label="badge" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'badge');
});
