from .models import Book


class BookRepository:
    def __init__(self) -> None:
        self._items: dict[str, Book] = {}

    def all(self) -> list[Book]:
        return sorted(self._items.values(), key=lambda item: item.name)

    def get(self, book_id: str) -> Book:
        try:
            return self._items[book_id]
        except KeyError as error:
            raise LookupError(f"Book {book_id} not found") from error

    def save(self, item: Book) -> None:
        self._items[item.id] = item
