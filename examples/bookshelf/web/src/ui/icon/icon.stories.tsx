import type { Meta } from '@storybook/react';
import { Icon } from './icon';

export default { title: 'UI/Icon', component: Icon } satisfies Meta<typeof Icon>;
export const Default = { args: { children: 'Icon' } };
