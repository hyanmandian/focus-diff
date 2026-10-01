from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import RecommendationRepository
from .schemas import RecommendationIn, RecommendationOut
from .service import RecommendationNotFound, RecommendationService

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


def service(session=Depends(get_session)) -> RecommendationService:
    return RecommendationService(RecommendationRepository(session))


@router.get("", response_model=list[RecommendationOut])
def search(search: str = "", svc: RecommendationService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=RecommendationOut)
def get(item_id: UUID, svc: RecommendationService = Depends(service)):
    try:
        return svc.get(item_id)
    except RecommendationNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Recommendation {error} not found") from error


@router.post("", response_model=RecommendationOut, status_code=status.HTTP_201_CREATED)
def create(data: RecommendationIn, svc: RecommendationService = Depends(service)):
    return svc.create(data)
