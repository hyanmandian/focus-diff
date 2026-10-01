from uuid import uuid4

import pytest

from bookshelf.users.schemas import UserIn
from bookshelf.users.service import UserNotFound, UserService


def test_create_trims_name(service_factory) -> None:
    svc: UserService = service_factory(UserService)
    assert svc.create(UserIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: UserService = service_factory(UserService)
    with pytest.raises(UserNotFound):
        svc.get(uuid4())
