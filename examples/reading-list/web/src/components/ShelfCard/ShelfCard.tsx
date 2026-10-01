import type { Shelf } from '../../types';
import { formatDate } from '../../utils/format';

type ShelfCardProps = {
  shelf: Shelf;
  onSelect?: (id: string) => void;
};

export function ShelfCard({ shelf, onSelect }: ShelfCardProps) {
  return (
    <article className="card" aria-labelledby={`shelf-${shelf.id}`}>
      <h3 id={`shelf-${shelf.id}`}>{shelf.name}</h3>
      <p className="card-meta">Updated {formatDate(shelf.updatedAt)}</p>
      {onSelect && (
        <button type="button" onClick={() => onSelect(shelf.id)}>
          Open shelf
        </button>
      )}
    </article>
  );
}
