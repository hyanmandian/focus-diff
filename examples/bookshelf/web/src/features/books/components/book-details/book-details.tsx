import { clsx } from 'clsx';
import styles from './book-details.module.css';

export type BookDetailsProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function BookDetails({ count, className, onAction }: BookDetailsProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="book-details">
      <header className={styles.header}>
        <h2 className={styles.title}>Book details</h2>
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
