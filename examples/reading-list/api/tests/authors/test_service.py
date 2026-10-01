import pytest

from reading_list.authors.models import Author
from reading_list.authors.repository import AuthorRepository
from reading_list.authors.service import AuthorService


@pytest.fixture
def service() -> AuthorService:
    repository = AuthorRepository()
    repository.save(Author(id="1", name="Alpha"))
    repository.save(Author(id="2", name="beta"))
    return AuthorService(repository)


def test_search_is_case_insensitive(service: AuthorService) -> None:
    assert [item.id for item in service.search("BETA")] == ["2"]


def test_rename_trims_whitespace(service: AuthorService) -> None:
    assert service.rename("1", "  Gamma ").name == "Gamma"


def test_rename_rejects_empty_names(service: AuthorService) -> None:
    with pytest.raises(ValueError):
        service.rename("1", "   ")


def test_rename_unknown_author(service: AuthorService) -> None:
    with pytest.raises(LookupError):
        service.rename("missing", "Delta")
