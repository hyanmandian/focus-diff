import { clsx } from 'clsx';
import styles from './create-shelf-dialog.module.css';

export type CreateShelfDialogProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function CreateShelfDialog({ title, className, onAction }: CreateShelfDialogProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="create-shelf-dialog">
      <header className={styles.header}>
        <h2 className={styles.title}>Create shelf dialog</h2>
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
