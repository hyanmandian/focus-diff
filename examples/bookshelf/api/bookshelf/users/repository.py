from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import User


class UserRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[User]:
        query = select(User).where(User.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> User | None:
        return self.session.get(User, item_id)

    def add(self, item: User) -> User:
        self.session.add(item)
        self.session.flush()
        return item
