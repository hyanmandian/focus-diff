import type { Meta, StoryObj } from '@storybook/react';
import { AuthorBio } from './author-bio';

const meta = { title: 'Authors/AuthorBio', component: AuthorBio } satisfies Meta<typeof AuthorBio>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
