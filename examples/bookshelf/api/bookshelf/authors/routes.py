from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import AuthorRepository
from .schemas import AuthorIn, AuthorOut
from .service import AuthorNotFound, AuthorService

router = APIRouter(prefix="/authors", tags=["authors"])


def service(session=Depends(get_session)) -> AuthorService:
    return AuthorService(AuthorRepository(session))


@router.get("", response_model=list[AuthorOut])
def search(search: str = "", svc: AuthorService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=AuthorOut)
def get(item_id: UUID, svc: AuthorService = Depends(service)):
    try:
        return svc.get(item_id)
    except AuthorNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Author {error} not found") from error


@router.post("", response_model=AuthorOut, status_code=status.HTTP_201_CREATED)
def create(data: AuthorIn, svc: AuthorService = Depends(service)):
    return svc.create(data)
