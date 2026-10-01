import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Skeleton = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Skeleton(props, ref) {
  return <div ref={ref} data-ui="skeleton" {...props} />;
});
