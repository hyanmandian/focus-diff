import type { Meta, StoryObj } from '@storybook/react';
import { ProfileForm } from './profile-form';

const meta = { title: 'Settings/ProfileForm', component: ProfileForm } satisfies Meta<typeof ProfileForm>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
