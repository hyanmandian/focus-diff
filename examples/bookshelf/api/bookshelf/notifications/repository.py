from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Notification


class NotificationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list(self, search: str = "", limit: int = 50) -> list[Notification]:
        query = select(Notification).where(Notification.name.ilike(f"%{search}%")).limit(limit)
        return list(self.session.scalars(query))

    def get(self, item_id: UUID) -> Notification | None:
        return self.session.get(Notification, item_id)

    def add(self, item: Notification) -> Notification:
        self.session.add(item)
        self.session.flush()
        return item
