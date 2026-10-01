import type { Author } from '../../types';
import { formatDate } from '../../utils/format';

type AuthorCardProps = {
  author: Author;
  onSelect?: (id: string) => void;
};

export function AuthorCard({ author, onSelect }: AuthorCardProps) {
  return (
    <article className="card" aria-labelledby={`author-${author.id}`}>
      <h3 id={`author-${author.id}`}>{author.name}</h3>
      <p className="card-meta">Updated {formatDate(author.updatedAt)}</p>
      {onSelect && (
        <button type="button" onClick={() => onSelect(author.id)}>
          Open author
        </button>
      )}
    </article>
  );
}
