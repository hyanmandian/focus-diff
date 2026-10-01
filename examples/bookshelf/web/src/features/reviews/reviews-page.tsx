import { useReviews } from './hooks/use-reviews';

export default function ReviewsPage() {
  const { data, isPending, error } = useReviews();
  if (isPending) return <p role="status">Loading reviews…</p>;
  if (error) return <p role="alert">Couldn't load reviews. Try again.</p>;
  return <pre>{data.total}</pre>;
}
