import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Button = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Button(props, ref) {
  return <div ref={ref} data-ui="button" {...props} />;
});
