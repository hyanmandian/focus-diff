import { clsx } from 'clsx';
import styles from './book-rating.module.css';

export type BookRatingProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function BookRating({ title, className, onAction }: BookRatingProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="book-rating">
      <header className={styles.header}>
        <h2 className={styles.title}>Book rating</h2>
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
