import type { Book } from '../../types';
import { formatDate } from '../../utils/format';

type BookCardProps = {
  book: Book;
  onSelect?: (id: string) => void;
};

export function BookCard({ book, onSelect }: BookCardProps) {
  return (
    <article className="card" aria-labelledby={`book-${book.id}`}>
      <h3 id={`book-${book.id}`}>{book.name}</h3>
      <p className="card-meta">Updated {formatDate(book.updatedAt)}</p>
      {onSelect && (
        <button type="button" onClick={() => onSelect(book.id)}>
          Open book
        </button>
      )}
    </article>
  );
}
