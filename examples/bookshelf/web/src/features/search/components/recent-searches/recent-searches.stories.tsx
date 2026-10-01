import type { Meta, StoryObj } from '@storybook/react';
import { RecentSearches } from './recent-searches';

const meta = { title: 'Search/RecentSearches', component: RecentSearches } satisfies Meta<typeof RecentSearches>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
