// Focus Diff's mark: focus brackets around two diff lines (the tray icon draws the same shape).
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={className} aria-hidden fill="currentColor">
      <path d="M3 4.2A1.2 1.2 0 0 1 4.2 3H11v3H6v5H3zM33 4.2A1.2 1.2 0 0 0 31.8 3H25v3h5v5h3zM3 31.8A1.2 1.2 0 0 0 4.2 33H11v-3H6v-5H3zM33 31.8a1.2 1.2 0 0 1-1.2 1.2H25v-3h5v-5h3z" />
      <rect x="11" y="13.5" width="14" height="3" rx="1.5" />
      <rect x="11" y="19.5" width="10" height="3" rx="1.5" />
    </svg>
  );
}
