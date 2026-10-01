import type { Meta, StoryObj } from '@storybook/react';
import { BookDetails } from './book-details';

const meta = { title: 'Books/BookDetails', component: BookDetails } satisfies Meta<typeof BookDetails>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const WithAction: Story = { args: { onAction: () => {} } };
