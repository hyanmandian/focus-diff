import type { Meta, StoryObj } from '@storybook/react';
import { NotificationList } from './notification-list';

const meta = { title: 'Notifications/NotificationList', component: NotificationList } satisfies Meta<typeof NotificationList>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
