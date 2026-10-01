import { clsx } from 'clsx';
import styles from './sign-in-form.module.css';

export type SignInFormProps = {
  count?: number;
  className?: string;
  onAction?: () => void;
};

export function SignInForm({ count, className, onAction }: SignInFormProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="sign-in-form">
      <header className={styles.header}>
        <h2 className={styles.title}>Sign in form</h2>
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
