import pytest

from reading_list.reviews.models import Review
from reading_list.reviews.repository import ReviewRepository
from reading_list.reviews.service import ReviewService


@pytest.fixture
def service() -> ReviewService:
    repository = ReviewRepository()
    repository.save(Review(id="1", name="Alpha"))
    repository.save(Review(id="2", name="beta"))
    return ReviewService(repository)


def test_search_is_case_insensitive(service: ReviewService) -> None:
    assert [item.id for item in service.search("BETA")] == ["2"]


def test_rename_trims_whitespace(service: ReviewService) -> None:
    assert service.rename("1", "  Gamma ").name == "Gamma"


def test_rename_rejects_empty_names(service: ReviewService) -> None:
    with pytest.raises(ValueError):
        service.rename("1", "   ")


def test_rename_unknown_review(service: ReviewService) -> None:
    with pytest.raises(LookupError):
        service.rename("missing", "Delta")
