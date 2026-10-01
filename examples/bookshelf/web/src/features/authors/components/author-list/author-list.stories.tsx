import type { Meta, StoryObj } from '@storybook/react';
import { AuthorList } from './author-list';

const meta = { title: 'Authors/AuthorList', component: AuthorList } satisfies Meta<typeof AuthorList>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
