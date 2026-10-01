import type { Meta, StoryObj } from '@storybook/react';
import { BookList } from './book-list';

const meta = { title: 'Books/BookList', component: BookList } satisfies Meta<typeof BookList>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
