import type { Meta, StoryObj } from '@storybook/react';
import { SearchBar } from './search-bar';

const meta = { title: 'Search/SearchBar', component: SearchBar } satisfies Meta<typeof SearchBar>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
