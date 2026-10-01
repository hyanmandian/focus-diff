import type { Meta, StoryObj } from '@storybook/react';
import { ReviewCard } from './ReviewCard';

const meta: Meta<typeof ReviewCard> = { component: ReviewCard };
export default meta;

export const Default: StoryObj<typeof ReviewCard> = {
  args: { review: { id: '1', name: 'Sample review', updatedAt: '2026-09-30T12:00:00Z' } },
};

export const Selectable: StoryObj<typeof ReviewCard> = {
  args: { ...Default.args, onSelect: () => {} },
};
