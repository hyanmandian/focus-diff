from fastapi import FastAPI
from fastapi.testclient import TestClient

from reading_list.tags.models import Tag
from reading_list.tags.repository import TagRepository
from reading_list.tags.routes import build
from reading_list.tags.service import TagService


def client() -> TestClient:
    repository = TagRepository()
    repository.save(Tag(id="1", name="Alpha"))
    app = FastAPI()
    app.include_router(build(TagService(repository)))
    return TestClient(app)


def test_search_returns_matches() -> None:
    assert client().get("/tags", params={"search": "alp"}).status_code == 200


def test_rename_unknown_returns_404() -> None:
    assert client().post("/tags/missing/rename", params={"name": "X"}).status_code == 404
