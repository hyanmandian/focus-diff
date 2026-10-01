import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Tooltip = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Tooltip(props, ref) {
  return <div ref={ref} data-ui="tooltip" {...props} />;
});
