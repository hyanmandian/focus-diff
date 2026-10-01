import type { Meta, StoryObj } from '@storybook/react';
import { SignUpForm } from './sign-up-form';

const meta = { title: 'Auth/SignUpForm', component: SignUpForm } satisfies Meta<typeof SignUpForm>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
