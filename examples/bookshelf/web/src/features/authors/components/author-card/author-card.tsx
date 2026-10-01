import { clsx } from 'clsx';
import styles from './author-card.module.css';

export type AuthorCardProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function AuthorCard({ title, className, onAction }: AuthorCardProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="author-card">
      <header className={styles.header}>
        <h2 className={styles.title}>Author card</h2>
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
