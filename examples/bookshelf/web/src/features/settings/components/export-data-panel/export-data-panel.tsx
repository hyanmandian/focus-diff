import { clsx } from 'clsx';
import styles from './export-data-panel.module.css';

export type ExportDataPanelProps = {
  isLoading?: boolean;
  className?: string;
  onAction?: () => void;
};

export function ExportDataPanel({ isLoading, className, onAction }: ExportDataPanelProps) {
  return (
    <section className={clsx(styles.root, className)} data-testid="export-data-panel">
      <header className={styles.header}>
        <h2 className={styles.title}>Export data panel</h2>
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
