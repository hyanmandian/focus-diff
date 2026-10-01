from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Review


class ReviewRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Review]:
        query = select(Review).where(Review.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Review | None:
        return self.session.get(Review, item_id)

    def add(self, item: Review) -> Review:
        self.session.add(item)
        self.session.flush()
        return item
