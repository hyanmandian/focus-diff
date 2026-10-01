import { http } from './http';

it('throws on errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
  await expect(http.get('/books')).rejects.toThrow('Request failed: 500');
});
