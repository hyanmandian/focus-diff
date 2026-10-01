from collections.abc import Iterator

from sqlalchemy.orm import Session

from .settings import session_factory


def get_session() -> Iterator[Session]:
    with session_factory() as session, session.begin():
        yield session
