from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from bookshelf.deps import get_session
from .repository import UserRepository
from .schemas import UserIn, UserOut
from .service import UserNotFound, UserService

router = APIRouter(prefix="/users", tags=["users"])


def service(session=Depends(get_session)) -> UserService:
    return UserService(UserRepository(session))


@router.get("", response_model=list[UserOut])
def search(search: str = "", svc: UserService = Depends(service)):
    return svc.search(search)


@router.get("/{item_id}", response_model=UserOut)
def get(item_id: UUID, svc: UserService = Depends(service)):
    try:
        return svc.get(item_id)
    except UserNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"User {error} not found") from error


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create(data: UserIn, svc: UserService = Depends(service)):
    return svc.create(data)
