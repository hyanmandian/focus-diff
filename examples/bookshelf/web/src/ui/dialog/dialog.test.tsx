import { render } from '@testing-library/react';
import { Dialog } from './dialog';

it('forwards props', () => {
  const { container } = render(<Dialog aria-label="dialog" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'dialog');
});
