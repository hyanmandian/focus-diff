import type { Meta } from '@storybook/react';
import { Tag } from './tag';

export default { title: 'UI/Tag', component: Tag } satisfies Meta<typeof Tag>;
export const Default = { args: { children: 'Tag' } };
