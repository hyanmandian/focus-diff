import mark from "@/components/mark/mark.svg?raw";

/** The mark's shapes, from mark.svg beside it, drawn inside the app's own <svg>. */
const SHAPES = mark.slice(mark.indexOf(">", mark.indexOf("<svg")) + 1, mark.lastIndexOf("</svg>"));

// Focus Diff's mark: focus brackets around two diff lines (the tray icon draws the same shape).
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className}
      aria-hidden
      fill="currentColor"
      // The app's own file, not anything from outside.
      dangerouslySetInnerHTML={{ __html: SHAPES }}
    />
  );
}
