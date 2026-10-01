import { clsx } from 'clsx';
import styles from './shelf-card.module.css';

export type ShelfCardProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function ShelfCard({ title, className, onAction }: ShelfCardProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="shelf-card">
      <header className={styles.header}>
        <h2 className={styles.title}>Shelf card</h2>
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
