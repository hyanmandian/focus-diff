import { clsx } from 'clsx';
import styles from './search-filters.module.css';

export type SearchFiltersProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function SearchFilters({ isLoading, className, onAction }: SearchFiltersProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="search-filters">
      <header className={styles.header}>
        <h2 className={styles.title}>Search filters</h2>
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
