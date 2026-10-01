export const http = {
  get: async <T>(url: string, init?: { params?: object }): Promise<T> => request<T>(url, init),
  delete: async (url: string) => request<void>(url, { method: 'DELETE' }),
};

async function request<T>(url: string, init: { params?: object; method?: string } = {}): Promise<T> {
  const query = init.params ? `?${new URLSearchParams(init.params as Record<string, string>)}` : '';
  const response = await fetch(`/api${url}${query}`, { method: init.method ?? 'GET' });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}
