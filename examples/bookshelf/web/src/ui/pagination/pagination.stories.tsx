import type { Meta } from '@storybook/react';
import { Pagination } from './pagination';

export default { title: 'UI/Pagination', component: Pagination } satisfies Meta<typeof Pagination>;
export const Default = { args: { children: 'Pagination' } };
