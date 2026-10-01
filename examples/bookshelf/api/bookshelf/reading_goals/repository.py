from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ReadingGoal


class ReadingGoalRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[ReadingGoal]:
        query = select(ReadingGoal).where(ReadingGoal.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> ReadingGoal | None:
        return self.session.get(ReadingGoal, item_id)

    def add(self, item: ReadingGoal) -> ReadingGoal:
        self.session.add(item)
        self.session.flush()
        return item
