from uuid import UUID

from .models import Review
from .repository import ReviewRepository
from .schemas import ReviewIn


class ReviewNotFound(LookupError):
    pass


class ReviewService:
    def __init__(self, repository: ReviewRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[Review]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> Review:
        item = self.repository.get(item_id)
        if item is None:
            raise ReviewNotFound(str(item_id))
        return item

    def create(self, data: ReviewIn) -> Review:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"Review {name!r} already exists")
        return self.repository.add(Review(name=name))
