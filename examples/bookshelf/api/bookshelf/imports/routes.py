from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import ImportRepository
from .schemas import ImportIn, ImportOut
from .service import ImportNotFound, ImportService

router = APIRouter(prefix="/imports", tags=["imports"])


def service(session=Depends(get_session)) -> ImportService:
    return ImportService(ImportRepository(session))


@router.get("", response_model=list[ImportOut])
def search(search: str = "", svc: ImportService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=ImportOut)
def get(item_id: UUID, svc: ImportService = Depends(service)):
    try:
        return svc.get(item_id)
    except ImportNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Import {error} not found") from error


@router.post("", response_model=ImportOut, status_code=status.HTTP_201_CREATED)
def create(data: ImportIn, svc: ImportService = Depends(service)):
    return svc.create(data)
