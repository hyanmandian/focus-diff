from fastapi import FastAPI
from fastapi.testclient import TestClient

from reading_list.authors.models import Author
from reading_list.authors.repository import AuthorRepository
from reading_list.authors.routes import build
from reading_list.authors.service import AuthorService


def client() -> TestClient:
    repository = AuthorRepository()
    repository.save(Author(id="1", name="Alpha"))
    app = FastAPI()
    app.include_router(build(AuthorService(repository)))
    return TestClient(app)


def test_search_returns_matches() -> None:
    assert client().get("/authors", params={"search": "alp"}).status_code == 200


def test_rename_unknown_returns_404() -> None:
    assert client().post("/authors/missing/rename", params={"name": "X"}).status_code == 404
