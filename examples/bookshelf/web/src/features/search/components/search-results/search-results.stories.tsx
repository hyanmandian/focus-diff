import type { Meta, StoryObj } from '@storybook/react';
import { SearchResults } from './search-results';

const meta = { title: 'Search/SearchResults', component: SearchResults } satisfies Meta<typeof SearchResults>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
