import type { Meta, StoryObj } from '@storybook/react';
import { SearchFilters } from './search-filters';

const meta = { title: 'Search/SearchFilters', component: SearchFilters } satisfies Meta<typeof SearchFilters>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
