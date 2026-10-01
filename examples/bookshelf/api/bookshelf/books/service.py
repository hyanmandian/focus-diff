from uuid import UUID

from .models import Book
from .repository import BookRepository
from .schemas import BookIn


class BookNotFound(LookupError):
    pass


class BookService:
    def __init__(self, repository: BookRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[Book]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> Book:
        item = self.repository.get(item_id)
        if item is None:
            raise BookNotFound(str(item_id))
        return item

    def create(self, data: BookIn) -> Book:
        return self.repository.add(Book(name=data.name.strip()))
