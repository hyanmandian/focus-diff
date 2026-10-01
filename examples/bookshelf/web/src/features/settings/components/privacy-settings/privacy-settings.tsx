import { clsx } from 'clsx';
import styles from './privacy-settings.module.css';

export type PrivacySettingsProps = {
  title?: string;
  className?: string;
  onAction?: () => void;
};

export function PrivacySettings({ title, className, onAction }: PrivacySettingsProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="privacy-settings">
      <header className={styles.header}>
        <h2 className={styles.title}>Privacy settings</h2>
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
