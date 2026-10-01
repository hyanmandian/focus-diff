from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import ReviewRepository
from .schemas import ReviewIn, ReviewOut
from .service import ReviewNotFound, ReviewService

router = APIRouter(prefix="/reviews", tags=["reviews"])


def service(session=Depends(get_session)) -> ReviewService:
    return ReviewService(ReviewRepository(session))


@router.get("", response_model=list[ReviewOut])
def search(search: str = "", svc: ReviewService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=ReviewOut)
def get(item_id: UUID, svc: ReviewService = Depends(service)):
    try:
        return svc.get(item_id)
    except ReviewNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Review {error} not found") from error


@router.post("", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def create(data: ReviewIn, svc: ReviewService = Depends(service)):
    return svc.create(data)
