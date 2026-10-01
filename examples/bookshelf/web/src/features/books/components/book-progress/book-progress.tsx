import { clsx } from 'clsx';
import styles from './book-progress.module.css';

export type BookProgressProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function BookProgress({ title, className, onAction }: BookProgressProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="book-progress">
      <header className={styles.header}>
        <h2 className={styles.title}>Book progress</h2>
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
