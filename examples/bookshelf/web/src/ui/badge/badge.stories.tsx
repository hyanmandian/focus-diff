import type { Meta } from '@storybook/react';
import { Badge } from './badge';

export default { title: 'UI/Badge', component: Badge } satisfies Meta<typeof Badge>;
export const Default = { args: { children: 'Badge' } };
