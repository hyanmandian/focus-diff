import { render } from '@testing-library/react';
import { Skeleton } from './skeleton';

it('forwards props', () => {
  const { container } = render(<Skeleton aria-label="skeleton" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'skeleton');
});
