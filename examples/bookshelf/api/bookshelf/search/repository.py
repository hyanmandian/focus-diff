from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Search


class SearchRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Search]:
        query = select(Search).where(Search.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Search | None:
        return self.session.get(Search, item_id)

    def add(self, item: Search) -> Search:
        self.session.add(item)
        self.session.flush()
        return item
