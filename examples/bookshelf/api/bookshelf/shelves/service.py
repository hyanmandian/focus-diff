from uuid import UUID

from .models import Shelve
from .repository import ShelveRepository
from .schemas import ShelveIn


class ShelveNotFound(LookupError):
    pass


class ShelveService:
    def __init__(self, repository: ShelveRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[Shelve]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> Shelve:
        item = self.repository.get(item_id)
        if item is None:
            raise ShelveNotFound(str(item_id))
        return item

    def create(self, data: ShelveIn) -> Shelve:
        return self.repository.add(Shelve(name=data.name.strip()))
