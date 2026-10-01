from uuid import uuid4


def test_create_returns_201(client) -> None:
    response = client.post("/books", json={"name": "Dune"})
    assert response.status_code == 201


def test_empty_name_is_rejected(client) -> None:
    assert client.post("/books", json={"name": ""}).status_code == 422


def test_unknown_id_returns_404(client) -> None:
    assert client.get(f"/books/{uuid4()}").status_code == 404
