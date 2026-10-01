import { useAuthors } from './hooks/use-authors';

export default function AuthorsPage() {
  const { data, isPending, error } = useAuthors();
  if (isPending) return <p role="status">Loading authors…</p>;
  if (error) return <p role="alert">Couldn't load authors. Try again.</p>;
  return <pre>{data.total}</pre>;
}
