import type { Meta, StoryObj } from '@storybook/react';
import { GoalProgressRing } from './goal-progress-ring';

const meta = { title: 'ReadingGoals/GoalProgressRing', component: GoalProgressRing } satisfies Meta<typeof GoalProgressRing>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
