from uuid import uuid4

import pytest

from bookshelf.search.schemas import SearchIn
from bookshelf.search.service import SearchNotFound, SearchService


def test_create_trims_name(service_factory) -> None:
    svc: SearchService = service_factory(SearchService)
    assert svc.create(SearchIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: SearchService = service_factory(SearchService)
    with pytest.raises(SearchNotFound):
        svc.get(uuid4())
