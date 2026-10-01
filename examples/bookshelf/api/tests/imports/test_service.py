from uuid import uuid4

import pytest

from bookshelf.imports.schemas import ImportIn
from bookshelf.imports.service import ImportNotFound, ImportService


def test_create_trims_name(service_factory) -> None:
    svc: ImportService = service_factory(ImportService)
    assert svc.create(ImportIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: ImportService = service_factory(ImportService)
    with pytest.raises(ImportNotFound):
        svc.get(uuid4())
