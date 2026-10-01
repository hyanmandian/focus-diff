import type { Meta } from '@storybook/react';
import { Skeleton } from './skeleton';

export default { title: 'UI/Skeleton', component: Skeleton } satisfies Meta<typeof Skeleton>;
export const Default = { args: { children: 'Skeleton' } };
