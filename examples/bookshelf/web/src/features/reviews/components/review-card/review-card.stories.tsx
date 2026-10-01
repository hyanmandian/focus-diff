import type { Meta, StoryObj } from '@storybook/react';
import { ReviewCard } from './review-card';

const meta = { title: 'Reviews/ReviewCard', component: ReviewCard } satisfies Meta<typeof ReviewCard>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
