from fastapi import APIRouter, HTTPException

from .service import ReviewService

router = APIRouter(prefix="/reviews", tags=["reviews"])


def build(service: ReviewService) -> APIRouter:
    @router.get("")
    def search(search: str = ""):
        return service.search(search)

    @router.post("/{review_id}/rename")
    def rename(review_id: str, name: str):
        try:
            return service.rename(review_id, name)
        except LookupError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    return router
