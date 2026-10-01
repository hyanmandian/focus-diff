from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ImportIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ImportOut(ImportIn):
    id: UUID
    created_at: datetime
