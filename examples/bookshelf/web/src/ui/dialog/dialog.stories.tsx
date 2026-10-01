import type { Meta } from '@storybook/react';
import { Dialog } from './dialog';

export default { title: 'UI/Dialog', component: Dialog } satisfies Meta<typeof Dialog>;
export const Default = { args: { children: 'Dialog' } };
