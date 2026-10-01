from fastapi import FastAPI
from fastapi.testclient import TestClient

from reading_list.reviews.models import Review
from reading_list.reviews.repository import ReviewRepository
from reading_list.reviews.routes import build
from reading_list.reviews.service import ReviewService


def client() -> TestClient:
    repository = ReviewRepository()
    repository.save(Review(id="1", name="Alpha"))
    app = FastAPI()
    app.include_router(build(ReviewService(repository)))
    return TestClient(app)


def test_search_returns_matches() -> None:
    assert client().get("/reviews", params={"search": "alp"}).status_code == 200


def test_rename_unknown_returns_404() -> None:
    assert client().post("/reviews/missing/rename", params={"name": "X"}).status_code == 404
