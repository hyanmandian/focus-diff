import { clsx } from 'clsx';
import styles from './recent-searches.module.css';

export type RecentSearchesProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function RecentSearches({ count, className, onAction }: RecentSearchesProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="recent-searches">
      <header className={styles.header}>
        <h2 className={styles.title}>Recent searches</h2>
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
