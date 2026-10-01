import { useReadingGoals } from './hooks/use-reading-goals';

export default function ReadingGoalsPage() {
  const { data, isPending, error } = useReadingGoals();
  if (isPending) return <p role="status">Loading reading goals…</p>;
  if (error) return <p role="alert">Couldn't load reading goals. Try again.</p>;
  return <pre>{data.total}</pre>;
}
