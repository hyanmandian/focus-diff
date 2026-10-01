import type { Meta, StoryObj } from '@storybook/react';
import { BookCard } from './BookCard';

const meta: Meta<typeof BookCard> = { component: BookCard };
export default meta;

export const Default: StoryObj<typeof BookCard> = {
  args: { book: { id: '1', name: 'Sample book', updatedAt: '2026-09-30T12:00:00Z' } },
};

export const Selectable: StoryObj<typeof BookCard> = {
  args: { ...Default.args, onSelect: () => {} },
};
