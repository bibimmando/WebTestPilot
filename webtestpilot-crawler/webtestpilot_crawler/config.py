from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class QueryParamPolicy:
    """Controls which query parameters are meaningful state identifiers."""

    ignored_names: set[str] = field(
        default_factory=lambda: {
            "fbclid",
            "gclid",
            "dclid",
            "msclkid",
            "mc_cid",
            "mc_eid",
            "ref",
            "referrer",
            "sessionid",
            "sid",
            "phpsessid",
        }
    )
    ignored_prefixes: tuple[str, ...] = ("utm_", "ga_", "pk_")
    keep_names: set[str] = field(default_factory=set)
    drop_unknown: bool = False

    # 쿼리 이름이 상태 식별에 필요해 URL에 남겨야 하는지 판단한다.
    def should_keep(self, name: str) -> bool:
        lowered = name.casefold()
        if lowered in {item.casefold() for item in self.keep_names}:
            return True
        if lowered in {item.casefold() for item in self.ignored_names}:
            return False
        if any(lowered.startswith(prefix.casefold()) for prefix in self.ignored_prefixes):
            return False
        return not self.drop_unknown


@dataclass(slots=True)
class CrawlLimits:
    max_pages: int = 50
    max_depth: int = 3
    max_actions_per_page: int = 8
    max_runtime_seconds: float = 120.0
    max_queue_size: int = 1_000
    max_states_per_url: int = 3
    max_variants_per_path_family: int = 6
    max_ai_candidates: int = 100
    navigation_timeout_ms: int = 20_000
    action_timeout_ms: int = 3_000
    settle_time_ms: int = 350
    max_text_chars: int = 2_000

    # 크롤 제한값에 음수가 들어오지 않았는지 검증한다.
    def validate(self) -> None:
        numeric = {
            "max_pages": self.max_pages,
            "max_depth": self.max_depth,
            "max_actions_per_page": self.max_actions_per_page,
            "max_runtime_seconds": self.max_runtime_seconds,
            "max_queue_size": self.max_queue_size,
            "max_states_per_url": self.max_states_per_url,
            "max_variants_per_path_family": self.max_variants_per_path_family,
            "max_ai_candidates": self.max_ai_candidates,
        }
        invalid = [name for name, value in numeric.items() if value < 0]
        if invalid:
            raise ValueError(f"Crawl limits must be non-negative: {', '.join(invalid)}")


@dataclass(slots=True)
class CrawlConfig:
    start_url: str
    output_dir: Path = Path("crawl-results")
    headless: bool = True
    same_origin_only: bool = True
    safe_interactions_only: bool = True
    benchmark_mode: bool = False
    benchmark_tokenizer: str = "auto"
    benchmark_max_content_chars: int = 1_000_000
    query_policy: QueryParamPolicy = field(default_factory=QueryParamPolicy)
    limits: CrawlLimits = field(default_factory=CrawlLimits)
    blocked_path_patterns: tuple[str, ...] = (
        r"(?i)/(logout|signout)(?:/|$)",
        r"(?i)/(delete|remove|destroy)(?:/|$)",
        r"(?i)/(checkout|purchase|payment)(?:/|$)",
    )
    user_agent: str = "WebTestPilotCrawler/0.1 (+authorized-testing-only)"

    # 시작 URL 형식과 하위 제한 설정을 실행 전에 검증한다.
    def validate(self) -> None:
        if not self.start_url.startswith(("http://", "https://")):
            raise ValueError("start_url must use http:// or https://")
        if self.benchmark_max_content_chars <= 0:
            raise ValueError("benchmark_max_content_chars must be positive")
        self.limits.validate()
