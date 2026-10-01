from uuid import UUID

from .models import Shelve
from .repository import ShelveRepository
from .schemas import ShelveIn


class ShelveNotFound(LookupError):
    pass


class ShelveService:
    def __init__(self, repository: ShelveRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[Shelve]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> Shelve:
        item = self.repository.get(item_id)
        if item is None:
            raise ShelveNotFound(str(item_id))
        return item

    def create(self, data: ShelveIn) -> Shelve:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"Shelve {name!r} already exists")
        return self.repository.add(Shelve(name=name))
