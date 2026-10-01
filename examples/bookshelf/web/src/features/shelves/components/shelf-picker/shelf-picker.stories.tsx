import type { Meta, StoryObj } from '@storybook/react';
import { ShelfPicker } from './shelf-picker';

const meta = { title: 'Shelves/ShelfPicker', component: ShelfPicker } satisfies Meta<typeof ShelfPicker>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
