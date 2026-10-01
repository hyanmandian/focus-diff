from bookshelf.pagination.page import Page


def test_offset() -> None:
    assert Page(number=3, size=20).offset == 40
