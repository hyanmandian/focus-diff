from .models import Review
from .repository import ReviewRepository


class ReviewService:
    def __init__(self, repository: ReviewRepository) -> None:
        self.repository = repository

    def search(self, term: str = "") -> list[Review]:
        term = term.casefold()
        return [item for item in self.repository.all() if term in item.name.casefold()]

    def rename(self, review_id: str, name: str) -> Review:
        item = self.repository.get(review_id)
        item.rename(name)
        self.repository.save(item)
        return item
