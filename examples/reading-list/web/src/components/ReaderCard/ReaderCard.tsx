import type { Reader } from '../../types';
import { formatDate } from '../../utils/format';

type ReaderCardProps = {
  reader: Reader;
  onSelect?: (id: string) => void;
};

export function ReaderCard({ reader, onSelect }: ReaderCardProps) {
  return (
    <article className="card" aria-labelledby={`reader-${reader.id}`}>
      <h3 id={`reader-${reader.id}`}>{reader.name}</h3>
      <p className="card-meta">Updated {formatDate(reader.updatedAt)}</p>
      {onSelect && (
        <button type="button" onClick={() => onSelect(reader.id)}>
          Open reader
        </button>
      )}
    </article>
  );
}
