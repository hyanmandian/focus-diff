import type { Meta, StoryObj } from '@storybook/react';
import { ShelfCard } from './ShelfCard';

const meta: Meta<typeof ShelfCard> = { component: ShelfCard };
export default meta;

export const Default: StoryObj<typeof ShelfCard> = {
  args: { shelf: { id: '1', name: 'Sample shelf', updatedAt: '2026-09-30T12:00:00Z' } },
};

export const Selectable: StoryObj<typeof ShelfCard> = {
  args: { ...Default.args, onSelect: () => {} },
};
