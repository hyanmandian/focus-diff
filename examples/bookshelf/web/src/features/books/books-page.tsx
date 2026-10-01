import { useBooks } from './hooks/use-books';

export default function BooksPage() {
  const { data, isPending, error } = useBooks();
  if (isPending) return <p role="status">Loading books…</p>;
  if (error) return <p role="alert">Couldn't load books. Try again.</p>;
  return <pre>{data.total}</pre>;
}
