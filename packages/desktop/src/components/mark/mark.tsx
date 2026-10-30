import mark from "@/components/mark/mark.svg?raw";

const SHAPES = mark.slice(mark.indexOf(">", mark.indexOf("<svg")) + 1, mark.lastIndexOf("</svg>"));

export function Mark({ className }: { className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 36 36"
      className={className}
      aria-hidden
      fill="currentColor"
      dangerouslySetInnerHTML={{ __html: SHAPES }}
    />
  );
}
