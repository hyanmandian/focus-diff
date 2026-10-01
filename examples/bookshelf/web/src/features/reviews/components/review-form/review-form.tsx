import { clsx } from 'clsx';
import styles from './review-form.module.css';

export type ReviewFormProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function ReviewForm({ count, className, onAction }: ReviewFormProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="review-form">
      <header className={styles.header}>
        <h2 className={styles.title}>Review form</h2>
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
