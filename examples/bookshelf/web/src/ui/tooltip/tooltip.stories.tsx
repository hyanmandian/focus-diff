import type { Meta } from '@storybook/react';
import { Tooltip } from './tooltip';

export default { title: 'UI/Tooltip', component: Tooltip } satisfies Meta<typeof Tooltip>;
export const Default = { args: { children: 'Tooltip' } };
