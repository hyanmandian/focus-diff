import type { Meta, StoryObj } from '@storybook/react';
import { GoalCard } from './goal-card';

const meta = { title: 'ReadingGoals/GoalCard', component: GoalCard } satisfies Meta<typeof GoalCard>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
