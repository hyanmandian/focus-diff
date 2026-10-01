import { clsx } from 'clsx';
import styles from './author-avatar.module.css';

export type AuthorAvatarProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function AuthorAvatar({ isLoading, className, onAction }: AuthorAvatarProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="author-avatar">
      <header className={styles.header}>
        <h2 className={styles.title}>Author avatar</h2>
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
