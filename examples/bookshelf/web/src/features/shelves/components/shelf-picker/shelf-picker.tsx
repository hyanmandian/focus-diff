import { clsx } from 'clsx';
import styles from './shelf-picker.module.css';

export type ShelfPickerProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function ShelfPicker({ title, className, onAction }: ShelfPickerProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="shelf-picker">
      <header className={styles.header}>
        <h2 className={styles.title}>Shelf picker</h2>
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
