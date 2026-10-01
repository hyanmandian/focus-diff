import { useAuth } from './hooks/use-auth';

export default function AuthPage() {
  const { data, isPending, error } = useAuth();
  if (isPending) return <p role="status">Loading auth…</p>;
  if (error) return <p role="alert">Couldn't load auth. Try again.</p>;
  return <pre>{data.total}</pre>;
}
