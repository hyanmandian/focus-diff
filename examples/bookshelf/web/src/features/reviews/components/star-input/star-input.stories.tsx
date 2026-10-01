import type { Meta, StoryObj } from '@storybook/react';
import { StarInput } from './star-input';

const meta = { title: 'Reviews/StarInput', component: StarInput } satisfies Meta<typeof StarInput>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
