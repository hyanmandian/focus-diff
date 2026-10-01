import { clsx } from 'clsx';
import styles from './reset-password-form.module.css';

export type ResetPasswordFormProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function ResetPasswordForm({ title, className, onAction }: ResetPasswordFormProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="reset-password-form">
      <header className={styles.header}>
        <h2 className={styles.title}>Reset password form</h2>
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
