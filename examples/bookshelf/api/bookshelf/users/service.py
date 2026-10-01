from uuid import UUID

from .models import User
from .repository import UserRepository
from .schemas import UserIn


class UserNotFound(LookupError):
    pass


class UserService:
    def __init__(self, repository: UserRepository) -> None:
        self.repository = repository

    def search(self, term: str, page: int = 1) -> list[User]:
        return self.repository.list(term.strip(), limit=50, offset=(page - 1) * 50)

    def get(self, item_id: UUID) -> User:
        item = self.repository.get(item_id)
        if item is None:
            raise UserNotFound(str(item_id))
        return item

    def create(self, data: UserIn) -> User:
        name = " ".join(data.name.split())
        if self.repository.exists(name):
            raise ValueError(f"User {name!r} already exists")
        return self.repository.add(User(name=name))
