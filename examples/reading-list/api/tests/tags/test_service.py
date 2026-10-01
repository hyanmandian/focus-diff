import pytest

from reading_list.tags.models import Tag
from reading_list.tags.repository import TagRepository
from reading_list.tags.service import TagService


@pytest.fixture
def service() -> TagService:
    repository = TagRepository()
    repository.save(Tag(id="1", name="Alpha"))
    repository.save(Tag(id="2", name="beta"))
    return TagService(repository)


def test_search_is_case_insensitive(service: TagService) -> None:
    assert [item.id for item in service.search("BETA")] == ["2"]


def test_rename_trims_whitespace(service: TagService) -> None:
    assert service.rename("1", "  Gamma ").name == "Gamma"


def test_rename_rejects_empty_names(service: TagService) -> None:
    with pytest.raises(ValueError):
        service.rename("1", "   ")


def test_rename_unknown_tag(service: TagService) -> None:
    with pytest.raises(LookupError):
        service.rename("missing", "Delta")
