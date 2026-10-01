"""WebTestPilot P4-P6 verification pipeline (opt-in, standard library only).

P4 dedup and evidence gate, P5 3/3 reproduction, P6 report of verified bugs.
This module writes its own files and does not modify existing crawler schemas.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Protocol, runtime_checkable

log = logging.getLogger(__name__)

REPORT_SCHEMA_VERSION = "webtestpilot.verify/1"
REQUIRED_ATTEMPTS = 3
# Rule and State verdicts may be confirmed; AI verdicts are capped at likely.
CONFIDENCE_CAP = {"rule": "confirmed", "state": "confirmed", "ai": "likely"}
_SAFE_ID = re.compile(r"[^A-Za-z0-9_.-]")


@dataclass(frozen=True)
class Candidate:
    id: str
    signature: str
    severity: str
    url: str
    action_path: tuple[str, ...]
    actual: str
    expected: str
    evidence_ids: tuple[str, ...]
    oracle: str = "rule"  # rule | state | ai
    ambiguous: bool = False


@dataclass
class ReplayOutcome:
    attempt: int
    reproduced: bool
    evidence_ids: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass
class OracleVerdict:
    is_bug: bool
    reason: str
    cited_evidence_ids: list[str]


@runtime_checkable
class Reproducer(Protocol):
    # 매 attempt마다 새 브라우저 컨텍스트에서 재실행하고 (재현여부, 증거ID) 반환
    async def replay(self, candidate: Candidate, attempt: int) -> tuple[bool, list[str]]:
        ...


@runtime_checkable
class SemanticOracle(Protocol):
    # 애매한 후보에 대해 근거 증거ID를 인용한 의미 판정 반환
    async def judge(self, candidate: Candidate, evidence_ids: list[str]) -> OracleVerdict:
        ...


@runtime_checkable
class BudgetGuard(Protocol):
    # 해당 심각도에서 오라클 호출 예산이 허용되는지 반환
    def oracle_allowed(self, severity: str) -> bool:
        ...


# 경로에 안전한 버그 ID 문자열로 변환
def _safe_id(raw: str) -> str:
    cleaned = _SAFE_ID.sub("_", raw).strip("._")
    return cleaned[:120] or "bug"


# 임시 파일 후 교체 방식으로 JSON을 원자적으로 기록
def _atomic_write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


class VerificationPipeline:
    """Bounded queue plus workers so P4/P5 overlap with P3 exploration."""

    # 파이프라인 구성요소와 큐, 상태 저장소 초기화
    def __init__(self, out_dir: str | Path, reproducer: Reproducer,
                 observed_evidence_ids: Iterable[str], *, workers: int = 1,
                 queue_size: int = 64, oracle: SemanticOracle | None = None,
                 budget: BudgetGuard | None = None, replay_timeout: float = 120.0) -> None:
        if workers < 1 or queue_size < 1:
            raise ValueError("workers and queue_size must be >= 1")
        self.out_dir = Path(out_dir)
        self.reproducer = reproducer
        self.oracle = oracle
        self.budget = budget
        self.replay_timeout = replay_timeout
        self._evidence: set[str] = set(observed_evidence_ids)
        self._queue: asyncio.Queue[Candidate | None] = asyncio.Queue(maxsize=queue_size)
        self._n_workers = workers
        self._workers: list[asyncio.Task[None]] = []
        self._seen: dict[str, Candidate] = {}
        self._verified: dict[str, dict] = {}
        self._stats = {"submitted": 0, "rejected_no_evidence": 0, "duplicates": 0,
                       "oracle_rejected": 0, "flaky": 0, "not_reproduced": 0, "errors": 0}
        self._closed = False
        self._started_at = time.time()

    # 워커 태스크들을 시작
    def start(self) -> None:
        if self._workers:
            return
        for i in range(self._n_workers):
            self._workers.append(asyncio.create_task(self._worker(), name=f"verify-{i}"))

    # P3에서 새로 관측된 증거 ID를 등록
    def add_evidence(self, ids: Iterable[str]) -> None:
        self._evidence.update(ids)

    # 실제 관측 증거 중 후보가 인용한 것만 반환
    def _real_evidence(self, ids: Iterable[str]) -> list[str]:
        return [e for e in ids if e in self._evidence]

    # 증거 검증과 서명 중복 제거 후 큐에 투입(큐가 차면 대기)
    async def submit(self, cand: Candidate) -> bool:
        if self._closed:
            raise RuntimeError("pipeline closed")
        self.start()
        self._stats["submitted"] += 1
        if not cand.signature or not self._real_evidence(cand.evidence_ids):
            self._stats["rejected_no_evidence"] += 1
            return False
        prev = self._seen.get(cand.signature)
        if prev is not None:
            self._stats["duplicates"] += 1
            return False
        self._seen[cand.signature] = cand
        await self._queue.put(cand)
        return True

    # 큐에서 후보를 꺼내 검증하고 예외를 격리하는 워커 루프
    async def _worker(self) -> None:
        while True:
            cand = await self._queue.get()
            try:
                if cand is None:
                    return
                await self._verify(cand)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - one bad candidate must not stop the pipeline
                self._stats["errors"] += 1
                log.exception("verification failed for %s: %s", getattr(cand, "id", "?"), exc)
            finally:
                self._queue.task_done()

    # 애매한 후보만 예산 허용 시 오라클 판정(근거는 실제 증거여야 함)
    async def _consult_oracle(self, cand: Candidate) -> dict | None:
        if not cand.ambiguous or self.oracle is None or self.budget is None:
            return None
        if not self.budget.oracle_allowed(cand.severity):
            return None
        verdict = await self.oracle.judge(cand, self._real_evidence(cand.evidence_ids))
        cited = self._real_evidence(verdict.cited_evidence_ids)
        return {"is_bug": bool(verdict.is_bug and cited), "reason": verdict.reason,
                "cited_evidence_ids": cited}

    # 정확히 3회 새 컨텍스트 재실행 결과를 수집
    async def _replay_all(self, cand: Candidate) -> list[ReplayOutcome]:
        outcomes: list[ReplayOutcome] = []
        for attempt in range(1, REQUIRED_ATTEMPTS + 1):
            try:
                ok, ids = await asyncio.wait_for(
                    self.reproducer.replay(cand, attempt), self.replay_timeout)
                real = [str(i) for i in ids]
                outcomes.append(ReplayOutcome(attempt, bool(ok) and bool(real), real))
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                outcomes.append(ReplayOutcome(attempt, False, [], f"{type(exc).__name__}: {exc}"))
        return outcomes

    # 후보 하나를 오라클·재현 단계로 검증하고 결과 저장
    async def _verify(self, cand: Candidate) -> None:
        oracle_info = await self._consult_oracle(cand)
        if oracle_info is not None and not oracle_info["is_bug"]:
            self._stats["oracle_rejected"] += 1
            self._persist_repro(cand, [], "oracle_rejected", oracle_info)
            return
        outcomes = await self._replay_all(cand)
        passed = sum(1 for o in outcomes if o.reproduced)
        if passed == REQUIRED_ATTEMPTS:
            status = CONFIDENCE_CAP.get(cand.oracle, "likely")
        elif passed > 0:
            status = "flaky"
            self._stats["flaky"] += 1
        else:
            status = "candidate"
            self._stats["not_reproduced"] += 1
        self._persist_repro(cand, outcomes, status, oracle_info)
        if passed == REQUIRED_ATTEMPTS:
            self._verified[cand.signature] = self._bug_entry(cand, outcomes, status, oracle_info)

    # repro/<bug_id>/ 아래 재현 결과와 단계를 기록
    def _persist_repro(self, cand: Candidate, outcomes: list[ReplayOutcome],
                       status: str, oracle_info: dict | None) -> None:
        bug_dir = self.out_dir / "repro" / _safe_id(cand.id)
        _atomic_write_json(bug_dir / "replays.json", {
            "schema_version": REPORT_SCHEMA_VERSION, "bug_id": cand.id,
            "signature": cand.signature, "status": status,
            "passed": sum(1 for o in outcomes if o.reproduced),
            "required": REQUIRED_ATTEMPTS,
            "attempts": [asdict(o) for o in outcomes], "oracle": oracle_info})
        _atomic_write_json(bug_dir / "steps.json", {
            "url": cand.url, "steps": list(cand.action_path)})

    # 리포트에 들어갈 검증된 버그 항목 구성
    def _bug_entry(self, cand: Candidate, outcomes: list[ReplayOutcome],
                   status: str, oracle_info: dict | None) -> dict:
        replay_ids = sorted({e for o in outcomes for e in o.evidence_ids})
        rel = f"repro/{_safe_id(cand.id)}"
        return {"id": cand.id, "signature": cand.signature, "type": cand.signature.split("|", 1)[0],
                "severity": cand.severity, "confidence": status, "oracle": cand.oracle,
                "url": cand.url, "steps": list(cand.action_path), "actual": cand.actual,
                "expected": cand.expected,
                "evidence_ids": self._real_evidence(cand.evidence_ids),
                "replay_evidence_ids": replay_ids, "reproduced": f"{REQUIRED_ATTEMPTS}/{REQUIRED_ATTEMPTS}",
                "evidence_path": rel, "semantic_oracle": oracle_info}

    # 검증된 버그만 담은 스키마 버전 report.json 기록
    def write_report(self) -> Path:
        path = self.out_dir / "report.json"
        bugs = sorted(self._verified.values(), key=lambda b: (b["severity"], b["id"]))
        _atomic_write_json(path, {
            "schema_version": REPORT_SCHEMA_VERSION,
            "summary": {**self._stats, "verified": len(bugs),
                        "duration_s": round(time.time() - self._started_at, 3)},
            "bugs": bugs})
        return path

    # 큐를 비우고 워커를 종료한 뒤 리포트 경로 반환
    async def close(self, timeout: float | None = None) -> Path:
        if not self._closed:
            self._closed = True
            self.start()
            try:
                for _ in self._workers:
                    await self._queue.put(None)
                await asyncio.wait_for(
                    asyncio.gather(*self._workers, return_exceptions=True), timeout)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                await self.cancel()
                self.write_report()
                raise
        return self.write_report()

    # 진행 중인 워커를 안전하게 취소
    async def cancel(self) -> None:
        self._closed = True
        for task in self._workers:
            task.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)

    # async with 진입 시 워커 시작
    async def __aenter__(self) -> "VerificationPipeline":
        self.start()
        return self

    # async with 종료 시 정상이면 drain, 예외면 취소 후 리포트 기록
    async def __aexit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            await self.close()
        else:
            await self.cancel()
            self.write_report()
