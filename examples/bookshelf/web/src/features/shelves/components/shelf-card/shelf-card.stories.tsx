import type { Meta, StoryObj } from '@storybook/react';
import { ShelfCard } from './shelf-card';

const meta = { title: 'Shelves/ShelfCard', component: ShelfCard } satisfies Meta<typeof ShelfCard>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
