from uuid import UUID

from .models import Book
from .repository import BookRepository
from .schemas import BookIn


class BookNotFound(LookupError):
    pass


class BookService:
    def __init__(self, repository: BookRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[Book]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> Book:
        item = self.repository.get(item_id)
        if item is None:
            raise BookNotFound(str(item_id))
        return item

    def create(self, data: BookIn) -> Book:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"Book {name!r} already exists")
        return self.repository.add(Book(name=name))
