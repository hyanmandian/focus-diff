from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Import


class ImportRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Import]:
        query = select(Import).where(Import.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Import | None:
        return self.session.get(Import, item_id)

    def add(self, item: Import) -> Import:
        self.session.add(item)
        self.session.flush()
        return item
