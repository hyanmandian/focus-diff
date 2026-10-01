from uuid import UUID

from .models import Recommendation
from .repository import RecommendationRepository
from .schemas import RecommendationIn


class RecommendationNotFound(LookupError):
    pass


class RecommendationService:
    def __init__(self, repository: RecommendationRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[Recommendation]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> Recommendation:
        item = self.repository.get(item_id)
        if item is None:
            raise RecommendationNotFound(str(item_id))
        return item

    def create(self, data: RecommendationIn) -> Recommendation:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"Recommendation {name!r} already exists")
        return self.repository.add(Recommendation(name=name))
