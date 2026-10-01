import type { Meta, StoryObj } from '@storybook/react';
import { CreateShelfDialog } from './create-shelf-dialog';

const meta = { title: 'Shelves/CreateShelfDialog', component: CreateShelfDialog } satisfies Meta<typeof CreateShelfDialog>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
