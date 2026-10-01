from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ReviewIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ReviewOut(ReviewIn):
    id: UUID
    created_at: datetime
