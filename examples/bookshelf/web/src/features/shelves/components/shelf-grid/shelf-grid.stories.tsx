import type { Meta, StoryObj } from '@storybook/react';
import { ShelfGrid } from './shelf-grid';

const meta = { title: 'Shelves/ShelfGrid', component: ShelfGrid } satisfies Meta<typeof ShelfGrid>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
