from .models import Tag
from .repository import TagRepository


class TagService:
    def __init__(self, repository: TagRepository) -> None:
        self.repository = repository

    def search(self, term: str = "") -> list[Tag]:
        term = term.casefold()
        return [item for item in self.repository.all() if term in item.name.casefold()]

    def rename(self, tag_id: str, name: str) -> Tag:
        item = self.repository.get(tag_id)
        item.rename(name)
        self.repository.save(item)
        return item
