import type { Meta, StoryObj } from '@storybook/react';
import { ReviewForm } from './review-form';

const meta = { title: 'Reviews/ReviewForm', component: ReviewForm } satisfies Meta<typeof ReviewForm>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
