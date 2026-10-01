import type { Meta, StoryObj } from '@storybook/react';
import { SignInForm } from './sign-in-form';

const meta = { title: 'Auth/SignInForm', component: SignInForm } satisfies Meta<typeof SignInForm>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
