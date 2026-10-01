from uuid import uuid4

import pytest

from bookshelf.authors.schemas import AuthorIn
from bookshelf.authors.service import AuthorNotFound, AuthorService


def test_create_trims_name(service_factory) -> None:
    svc: AuthorService = service_factory(AuthorService)
    assert svc.create(AuthorIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: AuthorService = service_factory(AuthorService)
    with pytest.raises(AuthorNotFound):
        svc.get(uuid4())
