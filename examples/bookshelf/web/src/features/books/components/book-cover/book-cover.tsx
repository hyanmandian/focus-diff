import { clsx } from 'clsx';
import styles from './book-cover.module.css';

export type BookCoverProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function BookCover({ title, className, onAction }: BookCoverProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="book-cover">
      <header className={styles.header}>
        <h2 className={styles.title}>Book cover</h2>
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
