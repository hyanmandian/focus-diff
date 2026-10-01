import type { Meta, StoryObj } from '@storybook/react';
import { AuthorCard } from './AuthorCard';

const meta: Meta<typeof AuthorCard> = { component: AuthorCard };
export default meta;

export const Default: StoryObj<typeof AuthorCard> = {
  args: { author: { id: '1', name: 'Sample author', updatedAt: '2026-09-30T12:00:00Z' } },
};

export const Selectable: StoryObj<typeof AuthorCard> = {
  args: { ...Default.args, onSelect: () => {} },
};
