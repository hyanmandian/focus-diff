from dataclasses import dataclass


@dataclass(frozen=True)
class Page:
    number: int = 1
    size: int = 50

    @property
    def offset(self) -> int:
        return (self.number - 1) * self.size
