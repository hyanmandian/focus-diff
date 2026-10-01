from fastapi import FastAPI
from fastapi.testclient import TestClient

from reading_list.readers.models import Reader
from reading_list.readers.repository import ReaderRepository
from reading_list.readers.routes import build
from reading_list.readers.service import ReaderService


def client() -> TestClient:
    repository = ReaderRepository()
    repository.save(Reader(id="1", name="Alpha"))
    app = FastAPI()
    app.include_router(build(ReaderService(repository)))
    return TestClient(app)


def test_search_returns_matches() -> None:
    assert client().get("/readers", params={"search": "alp"}).status_code == 200


def test_rename_unknown_returns_404() -> None:
    assert client().post("/readers/missing/rename", params={"name": "X"}).status_code == 404
