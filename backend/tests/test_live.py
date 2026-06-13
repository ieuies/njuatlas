import os

import pytest
import requests


LIVE_API_BASE = os.getenv("NJUATLAS_LIVE_API_BASE", "https://api.njuatlas.cn").rstrip("/")
RUN_LIVE = os.getenv("NJUATLAS_LIVE_API", "").lower() in {"1", "true", "yes"}


pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def live_session():
    session = requests.Session()
    session.headers.update({"Accept": "application/json"})
    return session


@pytest.mark.skipif(not RUN_LIVE, reason="set NJUATLAS_LIVE_API=1 to run live smoke tests")
class TestLiveApi:
    def test_health(self, live_session):
        response = live_session.get(f"{LIVE_API_BASE}/api/health", timeout=20)
        response.raise_for_status()
        assert response.json()["status"] == "ok"

    def test_posts_list(self, live_session):
        response = live_session.get(
            f"{LIVE_API_BASE}/api/posts",
            params={"page": 1, "page_size": 5},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        assert "items" in payload

    def test_guide_bundle(self, live_session):
        response = live_session.get(
            f"{LIVE_API_BASE}/api/places/guide-bundle",
            params={"campus": "鼓楼"},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        assert payload["categories"]

    def test_auth_config(self, live_session):
        response = live_session.get(f"{LIVE_API_BASE}/api/user/auth-config", timeout=20)
        response.raise_for_status()
        assert "registration_email_suffixes" in response.json()
