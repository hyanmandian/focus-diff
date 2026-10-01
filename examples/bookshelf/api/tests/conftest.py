import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from bookshelf.db import Base
from bookshelf.deps import get_session
from bookshelf.main import app


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def client(session):
    app.dependency_overrides[get_session] = lambda: session
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def service_factory(session):
    def build(service_class):
        repository_class = service_class.__init__.__annotations__["repository"]
        return service_class(repository_class(session))
    return build
