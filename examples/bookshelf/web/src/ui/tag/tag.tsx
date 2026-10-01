import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const Tag = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function Tag(props, ref) {
  return <div ref={ref} data-ui="tag" {...props} />;
});
