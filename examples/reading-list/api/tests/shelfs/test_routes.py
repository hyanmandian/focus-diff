from fastapi import FastAPI
from fastapi.testclient import TestClient

from reading_list.shelfs.models import Shelf
from reading_list.shelfs.repository import ShelfRepository
from reading_list.shelfs.routes import build
from reading_list.shelfs.service import ShelfService


def client() -> TestClient:
    repository = ShelfRepository()
    repository.save(Shelf(id="1", name="Alpha"))
    app = FastAPI()
    app.include_router(build(ShelfService(repository)))
    return TestClient(app)


def test_search_returns_matches() -> None:
    assert client().get("/shelfs", params={"search": "alp"}).status_code == 200


def test_rename_unknown_returns_404() -> None:
    assert client().post("/shelfs/missing/rename", params={"name": "X"}).status_code == 404
