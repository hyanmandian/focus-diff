from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Recommendation


class RecommendationRepository:
    model = Recommendation

    @classmethod
    def model_exists(cls, name: str):
        return select(cls.model.id).where(cls.model.name == name).exists()

    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50, offset: int = 0) -> list[Recommendation]:
        query = select(Recommendation).where(Recommendation.name.ilike(f"%{search}%")).limit(limit).offset(offset)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Recommendation | None:
        return self.session.get(Recommendation, item_id)

    def exists(self, name: str) -> bool:
        return self.session.scalar(select(self.model_exists(name))) is not None

    def add(self, item: Recommendation) -> Recommendation:
        self.session.add(item)
        self.session.flush()
        return item
