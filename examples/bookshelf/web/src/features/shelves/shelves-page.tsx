import { useShelves } from './hooks/use-shelves';

export default function ShelvesPage() {
  const { data, isPending, error } = useShelves();
  if (isPending) return <p role="status">Loading shelves…</p>;
  if (error) return <p role="alert">Couldn't load shelves. Try again.</p>;
  return <pre>{data.total}</pre>;
}
