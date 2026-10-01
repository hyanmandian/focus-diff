import { clsx } from 'clsx';
import styles from './shelf-grid.module.css';

export type ShelfGridProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function ShelfGrid({ isLoading, className, onAction }: ShelfGridProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="shelf-grid">
      <header className={styles.header}>
        <h2 className={styles.title}>Shelf grid</h2>
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
