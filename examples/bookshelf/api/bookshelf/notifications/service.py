from uuid import UUID

from .models import Notification
from .repository import NotificationRepository
from .schemas import NotificationIn


class NotificationNotFound(LookupError):
    pass


class NotificationService:
    def __init__(self, repository: NotificationRepository) -> None:
        self.repository = repository

    def search(self, term: str) -> list[Notification]:
        return self.repository.list(term.strip())

    def get(self, item_id: UUID) -> Notification:
        item = self.repository.get(item_id)
        if item is None:
            raise NotificationNotFound(str(item_id))
        return item

    def create(self, data: NotificationIn) -> Notification:
        return self.repository.add(Notification(name=data.name.strip()))
