from .models import Shelf


class ShelfRepository:
    def __init__(self) -> None:
        self._items: dict[str, Shelf] = {}

    def all(self) -> list[Shelf]:
        return sorted(self._items.values(), key=lambda item: item.name)

    def get(self, shelf_id: str) -> Shelf:
        try:
            return self._items[shelf_id]
        except KeyError as error:
            raise LookupError(f"Shelf {shelf_id} not found") from error

    def save(self, item: Shelf) -> None:
        self._items[item.id] = item
