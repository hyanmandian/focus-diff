from .models import Author
from .repository import AuthorRepository


class AuthorService:
    def __init__(self, repository: AuthorRepository) -> None:
        self.repository = repository

    def search(self, term: str = "") -> list[Author]:
        term = term.casefold()
        return [item for item in self.repository.all() if term in item.name.casefold()]

    def rename(self, author_id: str, name: str) -> Author:
        item = self.repository.get(author_id)
        item.rename(name)
        self.repository.save(item)
        return item
