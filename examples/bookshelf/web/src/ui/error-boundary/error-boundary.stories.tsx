import type { Meta } from '@storybook/react';
import { ErrorBoundary } from './error-boundary';

export default { title: 'UI/ErrorBoundary', component: ErrorBoundary } satisfies Meta<typeof ErrorBoundary>;
export const Default = { args: { children: 'ErrorBoundary' } };
