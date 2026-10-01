import { clsx } from 'clsx';
import styles from './sign-up-form.module.css';

export type SignUpFormProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function SignUpForm({ title, className, onAction }: SignUpFormProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="sign-up-form">
      <header className={styles.header}>
        <h2 className={styles.title}>Sign up form</h2>
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
