from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Book


class BookRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Book]:
        query = select(Book).where(Book.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Book | None:
        return self.session.get(Book, item_id)

    def add(self, item: Book) -> Book:
        self.session.add(item)
        self.session.flush()
        return item
