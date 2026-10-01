import type { Meta, StoryObj } from '@storybook/react';
import { NotificationBell } from './notification-bell';

const meta = { title: 'Notifications/NotificationBell', component: NotificationBell } satisfies Meta<typeof NotificationBell>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
