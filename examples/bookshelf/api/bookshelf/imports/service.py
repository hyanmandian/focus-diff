from uuid import UUID

from .models import Import
from .repository import ImportRepository
from .schemas import ImportIn


class ImportNotFound(LookupError):
    pass


class ImportService:
    def __init__(self, repository: ImportRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[Import]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> Import:
        item = self.repository.get(item_id)
        if item is None:
            raise ImportNotFound(str(item_id))
        return item

    def create(self, data: ImportIn) -> Import:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"Import {name!r} already exists")
        return self.repository.add(Import(name=name))
