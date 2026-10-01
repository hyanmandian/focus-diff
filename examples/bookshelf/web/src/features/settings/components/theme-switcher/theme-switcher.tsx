import { clsx } from 'clsx';
import styles from './theme-switcher.module.css';

export type ThemeSwitcherProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function ThemeSwitcher({ isLoading, className, onAction }: ThemeSwitcherProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="theme-switcher">
      <header className={styles.header}>
        <h2 className={styles.title}>Theme switcher</h2>
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
