import type { Meta, StoryObj } from '@storybook/react';
import { TagCard } from './TagCard';

const meta: Meta<typeof TagCard> = { component: TagCard };
export default meta;

export const Default: StoryObj<typeof TagCard> = {
  args: { tag: { id: '1', name: 'Sample tag', updatedAt: '2026-09-30T12:00:00Z' } },
};

export const Selectable: StoryObj<typeof TagCard> = {
  args: { ...Default.args, onSelect: () => {} },
};
