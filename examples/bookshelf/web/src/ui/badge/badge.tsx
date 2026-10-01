import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Badge = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Badge(props, ref) {
  return <div ref={ref} data-ui="badge" {...props} />;
});
