from uuid import UUID

from .models import Search
from .repository import SearchRepository
from .schemas import SearchIn


class SearchNotFound(LookupError):
    pass


class SearchService:
    def __init__(self, repository: SearchRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[Search]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> Search:
        item = self.repository.get(item_id)
        if item is None:
            raise SearchNotFound(str(item_id))
        return item

    def create(self, data: SearchIn) -> Search:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"Search {name!r} already exists")
        return self.repository.add(Search(name=name))
