import { clsx } from 'clsx';
import styles from './search-bar.module.css';

export type SearchBarProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function SearchBar({ title, className, onAction }: SearchBarProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="search-bar">
      <header className={styles.header}>
        <h2 className={styles.title}>Search bar</h2>
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
