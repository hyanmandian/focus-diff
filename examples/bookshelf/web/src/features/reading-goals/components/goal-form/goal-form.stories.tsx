import type { Meta, StoryObj } from '@storybook/react';
import { GoalForm } from './goal-form';

const meta = { title: 'ReadingGoals/GoalForm', component: GoalForm } satisfies Meta<typeof GoalForm>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
