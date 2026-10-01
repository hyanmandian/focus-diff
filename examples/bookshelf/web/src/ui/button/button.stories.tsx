import type { Meta } from '@storybook/react';
import { Button } from './button';

export default { title: 'UI/Button', component: Button } satisfies Meta<typeof Button>;
export const Default = { args: { children: 'Button' } };
