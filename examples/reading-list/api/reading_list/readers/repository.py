from .models import Reader


class ReaderRepository:
    def __init__(self) -> None:
        self._items: dict[str, Reader] = {}

    def all(self) -> list[Reader]:
        return sorted(self._items.values(), key=lambda item: item.name)

    def get(self, reader_id: str) -> Reader:
        try:
            return self._items[reader_id]
        except KeyError as error:
            raise LookupError(f"Reader {reader_id} not found") from error

    def save(self, item: Reader) -> None:
        self._items[item.id] = item
