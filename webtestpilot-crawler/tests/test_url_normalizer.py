from webtestpilot_crawler.config import QueryParamPolicy
from webtestpilot_crawler.url_normalizer import normalize_url, path_family, same_origin


def test_normalize_sorts_query_and_removes_tracking_and_fragment():
    policy = QueryParamPolicy()
    result = normalize_url(
        "HTTPS://Example.COM:443/a/../products/?utm_source=x&b=2&a=1#details",
        policy=policy,
    )
    assert result == "https://example.com/products/?a=1&b=2"


def test_policy_can_keep_only_explicit_query_names():
    policy = QueryParamPolicy(keep_names={"product_id"}, drop_unknown=True)
    result = normalize_url("https://example.com/item?view=grid&product_id=7", policy=policy)
    assert result == "https://example.com/item?product_id=7"


def test_relative_url_and_origins():
    result = normalize_url("../next", base_url="https://example.com/a/b")
    assert result == "https://example.com/next"
    assert same_origin("https://example.com/a", "https://EXAMPLE.com:443/b")
    assert not same_origin("https://example.com", "http://example.com")


def test_path_family_collapses_dates_ids_and_uuid():
    first = path_family("https://example.com/calendar/2026/09/24/item/123")
    second = path_family("https://example.com/calendar/2027/10/25/item/999")
    assert first == second
    assert "{n}" in first or "{date}" in first

