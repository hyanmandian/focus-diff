import { useSettings } from './hooks/use-settings';

export default function SettingsPage() {
  const { data, isPending, error } = useSettings();
  if (isPending) return <p role="status">Loading settings…</p>;
  if (error) return <p role="alert">Couldn't load settings. Try again.</p>;
  return <pre>{data.total}</pre>;
}
