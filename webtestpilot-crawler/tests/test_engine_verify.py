import asyncio
import json

from webtestpilot_crawler.engine_verify import Candidate, OracleVerdict, VerificationPipeline


class FakeReproducer:
    def __init__(self, outcomes):
        self.outcomes = outcomes
        self.attempts = []

    # 매번 독립 재현 결과와 증거 ID를 반환한다.
    async def replay(self, candidate, attempt):
        self.attempts.append((candidate.id, attempt))
        return self.outcomes[attempt - 1], [f"replay-{attempt}"]


# 실제 관찰 근거와 재현 3/3을 모두 만족한 후보만 보고한다.
def test_verification_reports_only_three_of_three(tmp_path):
    async def scenario():
        reproducer = FakeReproducer([True, True, True])
        pipeline = VerificationPipeline(tmp_path, reproducer, ["event-1"])
        good = Candidate("bug-1", "error|api", "high", "https://example.test/", (),
                         "500", "200", ("event-1",))
        bad = Candidate("bug-2", "error|other", "high", "https://example.test/", (),
                        "500", "200", ("fabricated",))
        assert await pipeline.submit(good)
        assert not await pipeline.submit(bad)
        report_path = await pipeline.close()
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert [bug["id"] for bug in report["bugs"]] == ["bug-1"]
        assert reproducer.attempts == [("bug-1", 1), ("bug-1", 2), ("bug-1", 3)]
        assert (tmp_path / "repro" / "bug-1" / "replays.json").exists()
    asyncio.run(scenario())


# 2회만 재현된 후보는 파일로 추적하지만 최종 버그 목록에는 넣지 않는다.
def test_verification_gates_flaky_candidate(tmp_path):
    async def scenario():
        pipeline = VerificationPipeline(tmp_path, FakeReproducer([True, False, True]), ["e1"])
        candidate = Candidate("flaky", "click|none", "medium", "https://example.test/", (),
                              "no change", "change", ("e1",))
        assert await pipeline.submit(candidate)
        report = json.loads((await pipeline.close()).read_text(encoding="utf-8"))
        assert report["bugs"] == []
        assert report["summary"]["flaky"] == 1
    asyncio.run(scenario())


# 의미 판정이 근거를 인용하지 못하면 재현 호출 전에 후보를 거른다.
def test_oracle_cannot_promote_without_real_evidence(tmp_path):
    class Oracle:
        # 존재하지 않는 근거를 인용한다.
        async def judge(self, candidate, evidence_ids):
            return OracleVerdict(True, "looks wrong", ["imagined"])

    class Budget:
        # 테스트에서는 의미 판정을 허용한다.
        def oracle_allowed(self, severity):
            return True

    async def scenario():
        reproducer = FakeReproducer([True, True, True])
        pipeline = VerificationPipeline(tmp_path, reproducer, ["e1"], oracle=Oracle(), budget=Budget())
        candidate = Candidate("ambiguous", "semantic|search", "medium", "https://example.test/", (),
                              "mismatch", "match", ("e1",), ambiguous=True)
        assert await pipeline.submit(candidate)
        report = json.loads((await pipeline.close()).read_text(encoding="utf-8"))
        assert report["bugs"] == []
        assert reproducer.attempts == []
    asyncio.run(scenario())
