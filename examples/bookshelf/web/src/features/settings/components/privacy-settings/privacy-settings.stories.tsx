import type { Meta, StoryObj } from '@storybook/react';
import { PrivacySettings } from './privacy-settings';

const meta = { title: 'Settings/PrivacySettings', component: PrivacySettings } satisfies Meta<typeof PrivacySettings>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
