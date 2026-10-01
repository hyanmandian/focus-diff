import { render } from '@testing-library/react';
import { Avatar } from './avatar';

it('forwards props', () => {
  const { container } = render(<Avatar aria-label="avatar" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'avatar');
});
