from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Book:
    id: str
    name: str
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def rename(self, name: str) -> None:
        if not name.strip():
            raise ValueError("Book name cannot be empty")
        self.name = name.strip()
        self.updated_at = datetime.now(timezone.utc)
