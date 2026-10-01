from fastapi import FastAPI
from fastapi.testclient import TestClient

from reading_list.books.models import Book
from reading_list.books.repository import BookRepository
from reading_list.books.routes import build
from reading_list.books.service import BookService


def client() -> TestClient:
    repository = BookRepository()
    repository.save(Book(id="1", name="Alpha"))
    app = FastAPI()
    app.include_router(build(BookService(repository)))
    return TestClient(app)


def test_search_returns_matches() -> None:
    assert client().get("/books", params={"search": "alp"}).status_code == 200


def test_rename_unknown_returns_404() -> None:
    assert client().post("/books/missing/rename", params={"name": "X"}).status_code == 404
