import { render } from '@testing-library/react';
import { Icon } from './icon';

it('forwards props', () => {
  const { container } = render(<Icon aria-label="icon" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'icon');
});
