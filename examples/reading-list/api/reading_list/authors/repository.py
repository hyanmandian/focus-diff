from .models import Author


class AuthorRepository:
    def __init__(self) -> None:
        self._items: dict[str, Author] = {}

    def all(self) -> list[Author]:
        return sorted(self._items.values(), key=lambda item: item.name)

    def get(self, author_id: str) -> Author:
        try:
            return self._items[author_id]
        except KeyError as error:
            raise LookupError(f"Author {author_id} not found") from error

    def save(self, item: Author) -> None:
        self._items[item.id] = item
