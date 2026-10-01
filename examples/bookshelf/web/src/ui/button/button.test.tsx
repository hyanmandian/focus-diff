import { render } from '@testing-library/react';
import { Button } from './button';

it('forwards props', () => {
  const { container } = render(<Button aria-label="button" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'button');
});
