from uuid import UUID

from .models import Author
from .repository import AuthorRepository
from .schemas import AuthorIn


class AuthorNotFound(LookupError):
    pass


class AuthorService:
    def __init__(self, repository: AuthorRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[Author]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> Author:
        item = self.repository.get(item_id)
        if item is None:
            raise AuthorNotFound(str(item_id))
        return item

    def create(self, data: AuthorIn) -> Author:
        return self.repository.add(Author(name=data.name.strip()))
