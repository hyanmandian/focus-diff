import pytest

from reading_list.shelfs.models import Shelf
from reading_list.shelfs.repository import ShelfRepository
from reading_list.shelfs.service import ShelfService


@pytest.fixture
def service() -> ShelfService:
    repository = ShelfRepository()
    repository.save(Shelf(id="1", name="Alpha"))
    repository.save(Shelf(id="2", name="beta"))
    return ShelfService(repository)


def test_search_is_case_insensitive(service: ShelfService) -> None:
    assert [item.id for item in service.search("BETA")] == ["2"]


def test_rename_trims_whitespace(service: ShelfService) -> None:
    assert service.rename("1", "  Gamma ").name == "Gamma"


def test_rename_rejects_empty_names(service: ShelfService) -> None:
    with pytest.raises(ValueError):
        service.rename("1", "   ")


def test_rename_unknown_shelf(service: ShelfService) -> None:
    with pytest.raises(LookupError):
        service.rename("missing", "Delta")
