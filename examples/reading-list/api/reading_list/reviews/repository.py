from .models import Review


class ReviewRepository:
    def __init__(self) -> None:
        self._items: dict[str, Review] = {}

    def all(self) -> list[Review]:
        return sorted(self._items.values(), key=lambda item: item.name)

    def get(self, review_id: str) -> Review:
        try:
            return self._items[review_id]
        except KeyError as error:
            raise LookupError(f"Review {review_id} not found") from error

    def save(self, item: Review) -> None:
        self._items[item.id] = item
