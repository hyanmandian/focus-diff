import { clsx } from 'clsx';
import styles from './goal-progress-ring.module.css';

export type GoalProgressRingProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function GoalProgressRing({ isLoading, className, onAction }: GoalProgressRingProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="goal-progress-ring">
      <header className={styles.header}>
        <h2 className={styles.title}>Goal progress ring</h2>
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
