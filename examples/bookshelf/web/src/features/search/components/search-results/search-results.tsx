import { clsx } from 'clsx';
import styles from './search-results.module.css';

export type SearchResultsProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function SearchResults({ title, className, onAction }: SearchResultsProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="search-results">
      <header className={styles.header}>
        <h2 className={styles.title}>Search results</h2>
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
