from .models import Reader
from .repository import ReaderRepository


class ReaderService:
    def __init__(self, repository: ReaderRepository) -> None:
        self.repository = repository

    def search(self, term: str = "") -> list[Reader]:
        term = term.casefold()
        return [item for item in self.repository.all() if term in item.name.casefold()]

    def rename(self, reader_id: str, name: str) -> Reader:
        item = self.repository.get(reader_id)
        item.rename(name)
        self.repository.save(item)
        return item
