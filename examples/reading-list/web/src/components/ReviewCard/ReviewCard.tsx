import type { Review } from '../../types';
import { formatDate } from '../../utils/format';

type ReviewCardProps = {
  review: Review;
  onSelect?: (id: string) => void;
};

export function ReviewCard({ review, onSelect }: ReviewCardProps) {
  return (
    <article className="card" aria-labelledby={`review-${review.id}`}>
      <h3 id={`review-${review.id}`}>{review.name}</h3>
      <p className="card-meta">Updated {formatDate(review.updatedAt)}</p>
      {onSelect && (
        <button type="button" onClick={() => onSelect(review.id)}>
          Open review
        </button>
      )}
    </article>
  );
}
