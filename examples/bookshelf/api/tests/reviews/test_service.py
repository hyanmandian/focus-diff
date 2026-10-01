from uuid import uuid4

import pytest

from bookshelf.reviews.schemas import ReviewIn
from bookshelf.reviews.service import ReviewNotFound, ReviewService


def test_create_trims_name(service_factory) -> None:
    svc: ReviewService = service_factory(ReviewService)
    assert svc.create(ReviewIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: ReviewService = service_factory(ReviewService)
    with pytest.raises(ReviewNotFound):
        svc.get(uuid4())
