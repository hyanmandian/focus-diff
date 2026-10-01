from uuid import UUID

from .models import Search
from .repository import SearchRepository
from .schemas import SearchIn


class SearchNotFound(LookupError):
    pass


class SearchService:
    def __init__(self, repository: SearchRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[Search]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> Search:
        item = self.repository.get(item_id)
        if item is None:
            raise SearchNotFound(str(item_id))
        return item

    def create(self, data: SearchIn) -> Search:
        return self.repository.add(Search(name=data.name.strip()))
