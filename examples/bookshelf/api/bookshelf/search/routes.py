from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import SearchRepository
from .schemas import SearchIn, SearchOut
from .service import SearchNotFound, SearchService

router = APIRouter(prefix="/search", tags=["search"])


def service(session=Depends(get_session)) -> SearchService:
    return SearchService(SearchRepository(session))


@router.get("", response_model=list[SearchOut])
def search(search: str = "", svc: SearchService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=SearchOut)
def get(item_id: UUID, svc: SearchService = Depends(service)):
    try:
        return svc.get(item_id)
    except SearchNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Search {error} not found") from error


@router.post("", response_model=SearchOut, status_code=status.HTTP_201_CREATED)
def create(data: SearchIn, svc: SearchService = Depends(service)):
    return svc.create(data)
