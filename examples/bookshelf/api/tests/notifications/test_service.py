from uuid import uuid4

import pytest

from bookshelf.notifications.schemas import NotificationIn
from bookshelf.notifications.service import NotificationNotFound, NotificationService


def test_create_trims_name(service_factory) -> None:
    svc: NotificationService = service_factory(NotificationService)
    assert svc.create(NotificationIn(name="  Dune  ")).name == "Dune"


def test_get_missing_raises(service_factory) -> None:
    svc: NotificationService = service_factory(NotificationService)
    with pytest.raises(NotificationNotFound):
        svc.get(uuid4())
