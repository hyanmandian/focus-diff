import { clsx } from 'clsx';
import styles from './notification-list.module.css';

export type NotificationListProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function NotificationList({ isLoading, className, onAction }: NotificationListProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="notification-list">
      <header className={styles.header}>
        <h2 className={styles.title}>Notification list</h2>
      </header>
      <div className={styles.body}>{String(isLoading ?? '')}</div>
      {onAction ? (
        <button type="button" className={styles.action} onClick={onAction}>
          Continue
        </button>
      ) : null}
    </section>
  );
}
