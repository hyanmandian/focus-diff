import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Icon = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Icon(props, ref) {
  return <div ref={ref} data-ui="icon" {...props} />;
});
