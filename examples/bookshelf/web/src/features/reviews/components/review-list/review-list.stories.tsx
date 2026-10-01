import type { Meta, StoryObj } from '@storybook/react';
import { ReviewList } from './review-list';

const meta = { title: 'Reviews/ReviewList', component: ReviewList } satisfies Meta<typeof ReviewList>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
