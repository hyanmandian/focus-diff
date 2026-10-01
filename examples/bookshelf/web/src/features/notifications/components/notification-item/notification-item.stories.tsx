import type { Meta, StoryObj } from '@storybook/react';
import { NotificationItem } from './notification-item';

const meta = { title: 'Notifications/NotificationItem', component: NotificationItem } satisfies Meta<typeof NotificationItem>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
