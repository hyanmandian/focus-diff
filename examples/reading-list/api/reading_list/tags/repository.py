from .models import Tag


class TagRepository:
    def __init__(self) -> None:
        self._items: dict[str, Tag] = {}

    def all(self) -> list[Tag]:
        return sorted(self._items.values(), key=lambda item: item.name)

    def get(self, tag_id: str) -> Tag:
        try:
            return self._items[tag_id]
        except KeyError as error:
            raise LookupError(f"Tag {tag_id} not found") from error

    def save(self, item: Tag) -> None:
        self._items[item.id] = item
