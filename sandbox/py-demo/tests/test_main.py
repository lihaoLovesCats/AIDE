from main import app


def test_ping() -> None:
    client = app.test_client()
    resp = client.get("/api/ping")
    assert resp.status_code == 200
    assert resp.get_json() == {"pong": True}
