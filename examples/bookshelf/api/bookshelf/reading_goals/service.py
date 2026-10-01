from uuid import UUID

from .models import ReadingGoal
from .repository import ReadingGoalRepository
from .schemas import ReadingGoalIn


class ReadingGoalNotFound(LookupError):
    pass


class ReadingGoalService:
    def __init__(self, repository: ReadingGoalRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[ReadingGoal]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> ReadingGoal:
        item = self.repository.get(item_id)
        if item is None:
            raise ReadingGoalNotFound(str(item_id))
        return item

    def create(self, data: ReadingGoalIn) -> ReadingGoal:
        return self.repository.add(ReadingGoal(name=data.name.strip()))
