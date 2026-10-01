import { render } from '@testing-library/react';
import { Pagination } from './pagination';

it('forwards props', () => {
  const { container } = render(<Pagination aria-label="pagination" />);
  expect(container.firstChild).toHaveAttribute('aria-label', 'pagination');
});
