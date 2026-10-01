import type { Meta, StoryObj } from '@storybook/react';
import { BookCover } from './book-cover';

const meta = { title: 'Books/BookCover', component: BookCover } satisfies Meta<typeof BookCover>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
