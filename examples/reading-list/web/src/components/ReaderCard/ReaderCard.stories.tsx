import type { Meta, StoryObj } from '@storybook/react';
import { ReaderCard } from './ReaderCard';

const meta: Meta<typeof ReaderCard> = { component: ReaderCard };
export default meta;

export const Default: StoryObj<typeof ReaderCard> = {
  args: { reader: { id: '1', name: 'Sample reader', updatedAt: '2026-09-30T12:00:00Z' } },
};

export const Selectable: StoryObj<typeof ReaderCard> = {
  args: { ...Default.args, onSelect: () => {} },
};
