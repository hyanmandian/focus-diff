import type { Meta } from '@storybook/react';
import { EmptyState } from './empty-state';

export default { title: 'UI/EmptyState', component: EmptyState } satisfies Meta<typeof EmptyState>;
export const Default = { args: { children: 'EmptyState' } };
