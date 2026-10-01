import { clsx } from 'clsx';
import styles from './goal-card.module.css';

export type GoalCardProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function GoalCard({ title, className, onAction }: GoalCardProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="goal-card">
      <header className={styles.header}>
        <h2 className={styles.title}>Goal card</h2>
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
