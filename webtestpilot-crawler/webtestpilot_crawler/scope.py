from __future__ import annotations

import re
import time
from collections import Counter

from .config import CrawlConfig
from .url_normalizer import path_family, same_origin


class ScopeGuard:
    # 허용 범위와 방문·상태·경로 패턴별 사용량을 추적한다.
    def __init__(self, config: CrawlConfig) -> None:
        self.config = config
        self.started_at = time.monotonic()
        self.visited_urls: set[str] = set()
        self.state_counts: Counter[str] = Counter()
        self.family_variants: dict[str, set[str]] = {}
        self.skip_reasons: Counter[str] = Counter()
        self._blocked = [re.compile(pattern) for pattern in config.blocked_path_patterns]

    # 전체 크롤 실행 시간이 설정된 한도를 넘었는지 확인한다.
    def runtime_exceeded(self) -> bool:
        return time.monotonic() - self.started_at >= self.config.limits.max_runtime_seconds

    # 깊이·출처·차단 경로·중복·패턴 변형 수를 기준으로 URL을 허용한다.
    def allow_url(self, url: str, depth: int, *, queued: bool = False) -> tuple[bool, str]:
        if depth > self.config.limits.max_depth:
            return self._deny("max_depth")
        if self.config.same_origin_only and not same_origin(self.config.start_url, url):
            return self._deny("external_origin")
        if any(pattern.search(url) for pattern in self._blocked):
            return self._deny("blocked_path")
        if url in self.visited_urls and not queued:
            return self._deny("visited_url")
        family = path_family(url)
        variants = self.family_variants.setdefault(family, set())
        if url not in variants and len(variants) >= self.config.limits.max_variants_per_path_family:
            return self._deny("path_family_variant_limit")
        return True, "allowed"

    # 방문 URL과 해당 경로 패턴의 실제 변형을 기록한다.
    def register_visit(self, url: str) -> None:
        self.visited_urls.add(url)
        self.family_variants.setdefault(path_family(url), set()).add(url)

    # 페이지 상태 중복과 URL별 상태 수 제한을 검사한 뒤 새 상태를 등록한다.
    def register_state(self, url: str, fingerprint: str) -> bool:
        key = f"{url}::{fingerprint}"
        if self.state_counts[key]:
            self.skip_reasons["duplicate_state"] += 1
            return False
        total_for_url = sum(count for item, count in self.state_counts.items() if item.startswith(f"{url}::"))
        if total_for_url >= self.config.limits.max_states_per_url:
            self.skip_reasons["state_limit_per_url"] += 1
            return False
        self.state_counts[key] += 1
        return True

    # 차단 사유 통계를 올리고 공통 거부 응답을 반환한다.
    def _deny(self, reason: str) -> tuple[bool, str]:
        self.skip_reasons[reason] += 1
        return False, reason
