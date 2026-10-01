import { clsx } from 'clsx';
import styles from './star-input.module.css';

export type StarInputProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function StarInput({ title, className, onAction }: StarInputProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="star-input">
      <header className={styles.header}>
        <h2 className={styles.title}>Star input</h2>
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
