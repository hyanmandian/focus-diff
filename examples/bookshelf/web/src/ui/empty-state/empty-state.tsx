import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const EmptyState = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function EmptyState(props, ref) {
  return <div ref={ref} data-ui="empty-state" {...props} />;
});
