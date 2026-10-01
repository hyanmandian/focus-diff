import { clsx } from 'clsx';
import styles from './author-bio.module.css';

export type AuthorBioProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function AuthorBio({ count, className, onAction }: AuthorBioProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="author-bio">
      <header className={styles.header}>
        <h2 className={styles.title}>Author bio</h2>
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
