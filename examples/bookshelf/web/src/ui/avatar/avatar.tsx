import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Avatar = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Avatar(props, ref) {
  return <div ref={ref} data-ui="avatar" {...props} />;
});
