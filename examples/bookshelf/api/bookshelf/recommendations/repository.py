from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Recommendation


class RecommendationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Recommendation]:
        query = select(Recommendation).where(Recommendation.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Recommendation | None:
        return self.session.get(Recommendation, item_id)

    def add(self, item: Recommendation) -> Recommendation:
        self.session.add(item)
        self.session.flush()
        return item
