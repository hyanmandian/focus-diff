import { render } from '@testing-library/react';
import { Tooltip } from './tooltip';

it('forwards props', () => {
  const { container } = render(<Tooltip aria-label="tooltip" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'tooltip');
});
