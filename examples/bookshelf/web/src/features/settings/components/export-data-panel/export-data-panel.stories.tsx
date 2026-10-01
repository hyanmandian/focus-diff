import type { Meta, StoryObj } from '@storybook/react';
import { ExportDataPanel } from './export-data-panel';

const meta = { title: 'Settings/ExportDataPanel', component: ExportDataPanel } satisfies Meta<typeof ExportDataPanel>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
