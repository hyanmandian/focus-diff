from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Author


class AuthorRepository:
    model = Author

    @classmethod
    def model_exists(cls, name: str):
        return select(cls.model.id).where(cls.model.name == name).exists()

    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50, offset: int = 0) -> list[Author]:
        query = select(Author).where(Author.name.ilike(f"%{search}%")).limit(limit).offset(offset)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Author | None:
        return self.session.get(Author, item_id)

    def exists(self, name: str) -> bool:
        return self.session.scalar(select(self.model_exists(name))) is not None

    def add(self, item: Author) -> Author:
        self.session.add(item)
        self.session.flush()
        return item
