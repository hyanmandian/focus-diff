import { useNotifications } from './hooks/use-notifications';

export default function NotificationsPage() {
  const { data, isPending, error } = useNotifications();
  if (isPending) return <p role="status">Loading notifications…</p>;
  if (error) return <p role="alert">Couldn't load notifications. Try again.</p>;
  return <pre>{data.total}</pre>;
}
