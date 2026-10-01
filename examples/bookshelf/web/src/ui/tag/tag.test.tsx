import { render } from '@testing-library/react';
import { Tag } from './tag';

it('forwards props', () => {
  const { container } = render(<Tag aria-label="tag" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'tag');
});
