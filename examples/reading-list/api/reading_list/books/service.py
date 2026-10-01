from .models import Book
from .repository import BookRepository


class BookService:
    def __init__(self, repository: BookRepository) -> None:
        self.repository = repository

    def search(self, term: str = "") -> list[Book]:
        term = term.casefold()
        return [item for item in self.repository.all() if term in item.name.casefold()]

    def rename(self, book_id: str, name: str) -> Book:
        item = self.repository.get(book_id)
        item.rename(name)
        self.repository.save(item)
        return item
