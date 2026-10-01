import type { Meta, StoryObj } from '@storybook/react';
import { AuthorAvatar } from './author-avatar';

const meta = { title: 'Authors/AuthorAvatar', component: AuthorAvatar } satisfies Meta<typeof AuthorAvatar>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
