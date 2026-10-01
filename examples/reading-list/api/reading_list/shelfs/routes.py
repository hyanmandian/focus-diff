from fastapi import APIRouter, HTTPException

from .service import ShelfService

router = APIRouter(prefix="/shelfs", tags=["shelfs"])


def build(service: ShelfService) -> APIRouter:
    @router.get("")
    def search(search: str = ""):
        return service.search(search)

    @router.post("/{shelf_id}/rename")
    def rename(shelf_id: str, name: str):
        try:
            return service.rename(shelf_id, name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return router
