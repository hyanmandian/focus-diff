import type { Meta, StoryObj } from '@storybook/react';
import { AuthorCard } from './author-card';

const meta = { title: 'Authors/AuthorCard', component: AuthorCard } satisfies Meta<typeof AuthorCard>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
