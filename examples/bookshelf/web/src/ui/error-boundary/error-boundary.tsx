import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const ErrorBoundary = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function ErrorBoundary(props, ref) {
  return <div ref={ref} data-ui="error-boundary" {...props} />;
});
