import mark from "@focus-diff/design-system/mark.svg?raw";

/** The mark's shapes, from the shared design system, drawn inside the app's own <svg>. */
const SHAPES = mark.slice(mark.indexOf(">", mark.indexOf("<svg")) + 1, mark.lastIndexOf("</svg>"));

// Focus Diff's mark: focus brackets around two diff lines (the tray icon draws the same shape).
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className}
      aria-hidden
      fill="currentColor"
      // The design system's own file, not anything from outside.
      dangerouslySetInnerHTML={{ __html: SHAPES }}
    />
  );
}
