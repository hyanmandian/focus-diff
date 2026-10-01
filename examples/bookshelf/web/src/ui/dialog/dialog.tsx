import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Dialog = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Dialog(props, ref) {
  return <div ref={ref} data-ui="dialog" {...props} />;
});
