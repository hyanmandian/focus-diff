import { clsx } from 'clsx';
import styles from './notification-item.module.css';

export type NotificationItemProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function NotificationItem({ isLoading, className, onAction }: NotificationItemProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="notification-item">
      <header className={styles.header}>
        <h2 className={styles.title}>Notification item</h2>
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
