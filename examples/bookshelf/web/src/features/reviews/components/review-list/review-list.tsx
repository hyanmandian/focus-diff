import { clsx } from 'clsx';
import styles from './review-list.module.css';

export type ReviewListProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function ReviewList({ count, className, onAction }: ReviewListProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="review-list">
      <header className={styles.header}>
        <h2 className={styles.title}>Review list</h2>
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
