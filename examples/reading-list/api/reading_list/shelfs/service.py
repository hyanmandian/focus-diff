from .models import Shelf
from .repository import ShelfRepository


class ShelfService:
    def __init__(self, repository: ShelfRepository) -> None:
        self.repository = repository

    def search(self, term: str = "") -> list[Shelf]:
        term = term.casefold()
        return [item for item in self.repository.all() if term in item.name.casefold()]

    def rename(self, shelf_id: str, name: str) -> Shelf:
        item = self.repository.get(shelf_id)
        item.rename(name)
        self.repository.save(item)
        return item
