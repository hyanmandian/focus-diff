import { clsx } from 'clsx';
import styles from './book-card.module.css';

export type BookCardProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function BookCard({ count, className, onAction }: BookCardProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="book-card">
      <header className={styles.header}>
        <h2 className={styles.title}>Book card</h2>
      </header>
      <div className={styles.body}>{String(count ?? '')}</div>
      {onAction ? (
        <button type="button" className={styles.action} onClick={onAction}>
          Continue
        </button>
      ) : null}
    </section>
  );
}
