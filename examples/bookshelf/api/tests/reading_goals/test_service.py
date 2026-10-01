from uuid import uuid4

import pytest

from bookshelf.reading_goals.schemas import ReadingGoalIn
from bookshelf.reading_goals.service import ReadingGoalNotFound, ReadingGoalService


def test_create_trims_name(service_factory) -> None:
    svc: ReadingGoalService = service_factory(ReadingGoalService)
    assert svc.create(ReadingGoalIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: ReadingGoalService = service_factory(ReadingGoalService)
    with pytest.raises(ReadingGoalNotFound):
        svc.get(uuid4())
