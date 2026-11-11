import pytest


@pytest.fixture(autouse=True)
def isolated_static_root(settings, tmp_path):
    # API tests need an existing static directory. The real files are separately
    # verified via Nginx/WhiteNoise in the smoke test.
    root = tmp_path / "staticfiles"
    root.mkdir()
    settings.STATIC_ROOT = root


@pytest.fixture(autouse=True)
def isolated_throttle_cache():
    from django.core.cache import cache
    cache.clear()  # Dedicated integration Redis database 2 only.
    yield
    cache.clear()
