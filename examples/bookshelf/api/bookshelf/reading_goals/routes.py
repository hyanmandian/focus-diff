from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import ReadingGoalRepository
from .schemas import ReadingGoalIn, ReadingGoalOut
from .service import ReadingGoalNotFound, ReadingGoalService

router = APIRouter(prefix="/reading-goals", tags=["reading_goals"])


def service(session=Depends(get_session)) -> ReadingGoalService:
    return ReadingGoalService(ReadingGoalRepository(session))


@router.get("", response_model=list[ReadingGoalOut])
def search(search: str = "", svc: ReadingGoalService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=ReadingGoalOut)
def get(item_id: UUID, svc: ReadingGoalService = Depends(service)):
    try:
        return svc.get(item_id)
    except ReadingGoalNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"ReadingGoal {error} not found") from error


@router.post("", response_model=ReadingGoalOut, status_code=status.HTTP_201_CREATED)
def create(data: ReadingGoalIn, svc: ReadingGoalService = Depends(service)):
    return svc.create(data)
