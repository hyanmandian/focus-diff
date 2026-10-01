import { clsx } from 'clsx';
import styles from './book-list.module.css';

export type BookListProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function BookList({ isLoading, className, onAction }: BookListProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="book-list">
      <header className={styles.header}>
        <h2 className={styles.title}>Book list</h2>
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
