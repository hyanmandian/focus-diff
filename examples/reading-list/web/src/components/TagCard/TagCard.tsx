import type { Tag } from '../../types';
import { formatDate } from '../../utils/format';

type TagCardProps = {
  tag: Tag;
  onSelect?: (id: string) => void;
};

export function TagCard({ tag, onSelect }: TagCardProps) {
  return (
    <article className="card" aria-labelledby={`tag-${tag.id}`}>
      <h3 id={`tag-${tag.id}`}>{tag.name}</h3>
      <p className="card-meta">Updated {formatDate(tag.updatedAt)}</p>
      {onSelect && (
        <button type="button" onClick={() => onSelect(tag.id)}>
          Open tag
        </button>
      )}
    </article>
  );
}
