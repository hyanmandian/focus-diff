from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Shelve


class ShelveRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Shelve]:
        query = select(Shelve).where(Shelve.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Shelve | None:
        return self.session.get(Shelve, item_id)

    def add(self, item: Shelve) -> Shelve:
        self.session.add(item)
        self.session.flush()
        return item
