from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import ShelveRepository
from .schemas import ShelveIn, ShelveOut
from .service import ShelveNotFound, ShelveService

router = APIRouter(prefix="/shelves", tags=["shelves"])


def service(session=Depends(get_session)) -> ShelveService:
    return ShelveService(ShelveRepository(session))


@router.get("", response_model=list[ShelveOut])
def search(search: str = "", svc: ShelveService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=ShelveOut)
def get(item_id: UUID, svc: ShelveService = Depends(service)):
    try:
        return svc.get(item_id)
    except ShelveNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Shelve {error} not found") from error


@router.post("", response_model=ShelveOut, status_code=status.HTTP_201_CREATED)
def create(data: ShelveIn, svc: ShelveService = Depends(service)):
    return svc.create(data)
