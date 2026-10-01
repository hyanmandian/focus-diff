import type { Meta, StoryObj } from '@storybook/react';
import { BookRating } from './book-rating';

const meta = { title: 'Books/BookRating', component: BookRating } satisfies Meta<typeof BookRating>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
