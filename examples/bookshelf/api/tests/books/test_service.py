from uuid import uuid4

import pytest

from bookshelf.books.schemas import BookIn
from bookshelf.books.service import BookNotFound, BookService


def test_create_trims_name(service_factory) -> None:
    svc: BookService = service_factory(BookService)
    assert svc.create(BookIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: BookService = service_factory(BookService)
    with pytest.raises(BookNotFound):
        svc.get(uuid4())
