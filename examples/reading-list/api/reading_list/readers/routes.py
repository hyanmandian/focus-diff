from fastapi import APIRouter, HTTPException

from .service import ReaderService

router = APIRouter(prefix="/readers", tags=["readers"])


def build(service: ReaderService) -> APIRouter:
    @router.get("")
    def search(search: str = ""):
        return service.search(search)

    @router.post("/{reader_id}/rename")
    def rename(reader_id: str, name: str):
        try:
            return service.rename(reader_id, name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return router
