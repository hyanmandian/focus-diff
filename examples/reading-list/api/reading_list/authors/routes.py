from fastapi import APIRouter, HTTPException

from .service import AuthorService

router = APIRouter(prefix="/authors", tags=["authors"])


def build(service: AuthorService) -> APIRouter:
    @router.get("")
    def search(search: str = ""):
        return service.search(search)

    @router.post("/{author_id}/rename")
    def rename(author_id: str, name: str):
        try:
            return service.rename(author_id, name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return router
