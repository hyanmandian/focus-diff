import { api } from './client';

describe('api client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));

  it('throws on non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500, statusText: 'Server Error' }));
    await expect(api.get('/books')).rejects.toThrow('500 Server Error');
  });
});
