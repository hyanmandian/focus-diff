from uuid import UUID

from .models import User
from .repository import UserRepository
from .schemas import UserIn


class UserNotFound(LookupError):
    pass


class UserService:
    def __init__(self, repository: UserRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[User]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> User:
        item = self.repository.get(item_id)
        if item is None:
            raise UserNotFound(str(item_id))
        return item

    def create(self, data: UserIn) -> User:
        return self.repository.add(User(name=data.name.strip()))
