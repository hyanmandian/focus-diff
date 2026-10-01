import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Pagination = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Pagination(props, ref) {
  return <div ref={ref} data-ui="pagination" {...props} />;
});
