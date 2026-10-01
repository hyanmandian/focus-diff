from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import NotificationRepository
from .schemas import NotificationIn, NotificationOut
from .service import NotificationNotFound, NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


def service(session=Depends(get_session)) -> NotificationService:
    return NotificationService(NotificationRepository(session))


@router.get("", response_model=list[NotificationOut])
def search(search: str = "", svc: NotificationService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=NotificationOut)
def get(item_id: UUID, svc: NotificationService = Depends(service)):
    try:
        return svc.get(item_id)
    except NotificationNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Notification {error} not found") from error


@router.post("", response_model=NotificationOut, status_code=status.HTTP_201_CREATED)
def create(data: NotificationIn, svc: NotificationService = Depends(service)):
    return svc.create(data)
