import { clsx } from 'clsx';
import styles from './author-list.module.css';

export type AuthorListProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function AuthorList({ isLoading, className, onAction }: AuthorListProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="author-list">
      <header className={styles.header}>
        <h2 className={styles.title}>Author list</h2>
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
