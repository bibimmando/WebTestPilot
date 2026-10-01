from __future__ import annotations

import heapq
import itertools
from collections import Counter
from dataclasses import dataclass, field

from .models import AIReviewCandidate, CrawlTask


@dataclass(order=True, slots=True)
class _HeapItem:
    sort_key: tuple[float, int]
    value: object = field(compare=False)


class PriorityFrontier:
    """Best-first BFS: depth dominates, then information value breaks ties."""

    # URL 중복을 막는 제한 크기 우선순위 힙을 초기화한다.
    def __init__(self, max_size: int = 1_000) -> None:
        self._heap: list[_HeapItem] = []
        self._sequence = itertools.count()
        self._queued_urls: set[str] = set()
        self._category_counts: Counter[str] = Counter()
        self.max_size = max_size

    # 깊이를 우선하고 정보가치와 신규성을 보조 점수로 사용해 작업을 넣는다.
    def push(self, task: CrawlTask, information_value: float = 0.0) -> bool:
        if task.url in self._queued_urls or len(self._heap) >= self.max_size:
            return False
        # 같은 깊이에서는 덜 탐색한 기능 카테고리를 먼저 선택한다.
        category_penalty = min(self._category_counts[task.category], 10) * 8.0
        # A depth step is deliberately worth more than all ordinary score bonuses.
        priority = task.depth * 1_000.0 + category_penalty - information_value - (task.novelty * 5.0)
        heapq.heappush(self._heap, _HeapItem((priority, next(self._sequence)), task))
        self._queued_urls.add(task.url)
        self._category_counts[task.category] += 1
        return True

    # 다음 탐색 작업을 꺼내고 URL을 대기 중 목록에서 제거한다.
    def pop(self) -> CrawlTask:
        item = heapq.heappop(self._heap)
        task = item.value
        assert isinstance(task, CrawlTask)
        self._queued_urls.discard(task.url)
        return task

    # 대기 중인 크롤 작업이 있는지 반환한다.
    def __bool__(self) -> bool:
        return bool(self._heap)

    # 대기 중인 크롤 작업 수를 반환한다.
    def __len__(self) -> int:
        return len(self._heap)


class AIReviewQueue:
    # 토큰 대비 우선순위가 높은 AI 검토 후보를 제한된 수만 유지한다.
    def __init__(self, max_size: int = 100) -> None:
        self._heap: list[_HeapItem] = []
        self._sequence = itertools.count()
        self._dedupe_keys: set[str] = set()
        self.duplicates_suppressed = 0
        self.max_size = max_size

    # 후보를 비용 효율순으로 삽입하고 가치가 낮은 초과 후보를 버린다.
    def push(self, candidate: AIReviewCandidate) -> bool:
        if self.max_size == 0:
            return False
        if candidate.dedupe_key and candidate.dedupe_key in self._dedupe_keys:
            self.duplicates_suppressed += 1
            return False
        efficiency = candidate.priority / max(candidate.estimated_tokens, 1)
        item = _HeapItem((-efficiency, next(self._sequence)), candidate)
        if len(self._heap) < self.max_size:
            heapq.heappush(self._heap, item)
            if candidate.dedupe_key:
                self._dedupe_keys.add(candidate.dedupe_key)
            return True
        worst_index = max(range(len(self._heap)), key=lambda index: self._heap[index].sort_key)
        if item.sort_key < self._heap[worst_index].sort_key:
            removed = self._heap[worst_index].value
            if isinstance(removed, AIReviewCandidate) and removed.dedupe_key:
                self._dedupe_keys.discard(removed.dedupe_key)
            self._heap[worst_index] = item
            heapq.heapify(self._heap)
            if candidate.dedupe_key:
                self._dedupe_keys.add(candidate.dedupe_key)
            return True
        return False

    # AI 검토 후보를 비용 효율이 높은 순서로 반환한다.
    def ordered(self) -> list[AIReviewCandidate]:
        items = sorted(self._heap)
        return [item.value for item in items if isinstance(item.value, AIReviewCandidate)]

    # 현재 보관 중인 AI 검토 후보 수를 반환한다.
    def __len__(self) -> int:
        return len(self._heap)
