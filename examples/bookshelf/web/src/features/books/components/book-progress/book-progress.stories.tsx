import type { Meta, StoryObj } from '@storybook/react';
import { BookProgress } from './book-progress';

const meta = { title: 'Books/BookProgress', component: BookProgress } satisfies Meta<typeof BookProgress>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
