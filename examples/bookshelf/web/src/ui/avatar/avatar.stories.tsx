import type { Meta } from '@storybook/react';
import { Avatar } from './avatar';

export default { title: 'UI/Avatar', component: Avatar } satisfies Meta<typeof Avatar>;
export const Default = { args: { children: 'Avatar' } };
