import { clsx } from 'clsx';
import styles from './review-card.module.css';

export type ReviewCardProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function ReviewCard({ title, className, onAction }: ReviewCardProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="review-card">
      <header className={styles.header}>
        <h2 className={styles.title}>Review card</h2>
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
