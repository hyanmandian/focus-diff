from fastapi import APIRouter, HTTPException

from .service import BookService

router = APIRouter(prefix="/books", tags=["books"])


def build(service: BookService) -> APIRouter:
    @router.get("")
    def search(search: str = ""):
        return service.search(search)

    @router.post("/{book_id}/rename")
    def rename(book_id: str, name: str):
        try:
            return service.rename(book_id, name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return router
