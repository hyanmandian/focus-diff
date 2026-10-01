import { render, screen } from '@testing-library/react';
import { ReadingList } from './ReadingList';
import { mockApi, renderWithProviders } from '../test/utils';

describe('ReadingList', () => {
  it('shows the book count', async () => {
    mockApi.get.mockResolvedValue([{ id: '1', name: 'Dune', updatedAt: '2026-09-30T12:00:00Z' }]);
    renderWithProviders(<ReadingList />);
    expect(await screen.findByText('1 book')).toBeInTheDocument();
  });
});
