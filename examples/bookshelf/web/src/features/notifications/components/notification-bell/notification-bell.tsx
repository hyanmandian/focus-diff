import { clsx } from 'clsx';
import styles from './notification-bell.module.css';

export type NotificationBellProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function NotificationBell({ title, className, onAction }: NotificationBellProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="notification-bell">
      <header className={styles.header}>
        <h2 className={styles.title}>Notification bell</h2>
      </header>
      <div className={styles.body}>{String(title ?? '')}</div>
      {onAction ? (
        <button type="button" className={styles.action} onClick={onAction}>
          Continue
        </button>
      ) : null}
    </section>
  );
}
