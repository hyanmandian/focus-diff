import type { Meta, StoryObj } from '@storybook/react';
import { BookCard } from './book-card';

const meta = { title: 'Books/BookCard', component: BookCard } satisfies Meta<typeof BookCard>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
