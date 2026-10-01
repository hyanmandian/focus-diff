import { useSearch } from './hooks/use-search';

export default function SearchPage() {
  const { data, isPending, error } = useSearch();
  if (isPending) return <p role="status">Loading search…</p>;
  if (error) return <p role="alert">Couldn't load search. Try again.</p>;
  return <pre>{data.total}</pre>;
}
