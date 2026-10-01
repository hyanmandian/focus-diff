from uuid import uuid4

import pytest

from bookshelf.recommendations.schemas import RecommendationIn
from bookshelf.recommendations.service import RecommendationNotFound, RecommendationService


def test_create_trims_name(service_factory) -> None:
    svc: RecommendationService = service_factory(RecommendationService)
    assert svc.create(RecommendationIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: RecommendationService = service_factory(RecommendationService)
    with pytest.raises(RecommendationNotFound):
        svc.get(uuid4())
