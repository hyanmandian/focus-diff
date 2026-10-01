import { clsx } from 'clsx';
import styles from './profile-form.module.css';

export type ProfileFormProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function ProfileForm({ isLoading, className, onAction }: ProfileFormProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="profile-form">
      <header className={styles.header}>
        <h2 className={styles.title}>Profile form</h2>
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
