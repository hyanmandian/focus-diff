import { clsx } from 'clsx';
import styles from './goal-form.module.css';

export type GoalFormProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function GoalForm({ title, className, onAction }: GoalFormProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="goal-form">
      <header className={styles.header}>
        <h2 className={styles.title}>Goal form</h2>
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
