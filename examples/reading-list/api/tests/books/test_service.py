import pytest

from reading_list.books.models import Book
from reading_list.books.repository import BookRepository
from reading_list.books.service import BookService


@pytest.fixture
def service() -> BookService:
    repository = BookRepository()
    repository.save(Book(id="1", name="Alpha"))
    repository.save(Book(id="2", name="beta"))
    return BookService(repository)


def test_search_is_case_insensitive(service: BookService) -> None:
    assert [item.id for item in service.search("BETA")] == ["2"]


def test_rename_trims_whitespace(service: BookService) -> None:
    assert service.rename("1", "  Gamma ").name == "Gamma"


def test_rename_rejects_empty_names(service: BookService) -> None:
    with pytest.raises(ValueError):
        service.rename("1", "   ")


def test_rename_unknown_book(service: BookService) -> None:
    with pytest.raises(LookupError):
        service.rename("missing", "Delta")
