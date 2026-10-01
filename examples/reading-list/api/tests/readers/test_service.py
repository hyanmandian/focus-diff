import pytest

from reading_list.readers.models import Reader
from reading_list.readers.repository import ReaderRepository
from reading_list.readers.service import ReaderService


@pytest.fixture
def service() -> ReaderService:
    repository = ReaderRepository()
    repository.save(Reader(id="1", name="Alpha"))
    repository.save(Reader(id="2", name="beta"))
    return ReaderService(repository)


def test_search_is_case_insensitive(service: ReaderService) -> None:
    assert [item.id for item in service.search("BETA")] == ["2"]


def test_rename_trims_whitespace(service: ReaderService) -> None:
    assert service.rename("1", "  Gamma ").name == "Gamma"


def test_rename_rejects_empty_names(service: ReaderService) -> None:
    with pytest.raises(ValueError):
        service.rename("1", "   ")


def test_rename_unknown_reader(service: ReaderService) -> None:
    with pytest.raises(LookupError):
        service.rename("missing", "Delta")
