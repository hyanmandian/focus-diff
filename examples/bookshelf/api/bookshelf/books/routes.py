from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import BookRepository
from .schemas import BookIn, BookOut
from .service import BookNotFound, BookService

router = APIRouter(prefix="/books", tags=["books"])


def service(session=Depends(get_session)) -> BookService:
    return BookService(BookRepository(session))


@router.get("", response_model=list[BookOut])
def search(search: str = "", svc: BookService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=BookOut)
def get(item_id: UUID, svc: BookService = Depends(service)):
    try:
        return svc.get(item_id)
    except BookNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Book {error} not found") from error


@router.post("", response_model=BookOut, status_code=status.HTTP_201_CREATED)
def create(data: BookIn, svc: BookService = Depends(service)):
    return svc.create(data)
