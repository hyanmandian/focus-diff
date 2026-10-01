from uuid import uuid4

import pytest

from bookshelf.shelves.schemas import ShelveIn
from bookshelf.shelves.service import ShelveNotFound, ShelveService


def test_create_trims_name(service_factory) -> None:
    svc: ShelveService = service_factory(ShelveService)
    assert svc.create(ShelveIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: ShelveService = service_factory(ShelveService)
    with pytest.raises(ShelveNotFound):
        svc.get(uuid4())
