from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class BookIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class BookOut(BookIn):
    id: UUID
    created_at: datetime
