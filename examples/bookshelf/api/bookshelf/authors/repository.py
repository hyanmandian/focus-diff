from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Author


class AuthorRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Author]:
        query = select(Author).where(Author.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Author | None:
        return self.session.get(Author, item_id)

    def add(self, item: Author) -> Author:
        self.session.add(item)
        self.session.flush()
        return item
