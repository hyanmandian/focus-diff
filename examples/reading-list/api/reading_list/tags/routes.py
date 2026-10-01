from fastapi import APIRouter, HTTPException

from .service import TagService

router = APIRouter(prefix="/tags", tags=["tags"])


def build(service: TagService) -> APIRouter:
    @router.get("")
    def search(search: str = ""):
        return service.search(search)

    @router.post("/{tag_id}/rename")
    def rename(tag_id: str, name: str):
        try:
            return service.rename(tag_id, name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return router
