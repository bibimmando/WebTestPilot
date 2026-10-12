"""Local-only, deterministic Korean PDF rendering from validated records."""
from io import BytesIO
from pathlib import Path, PureWindowsPath
import os
import tempfile
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image

from .contract import InputError, counts, sanitize, validate

LABELS = {"confirmed": "시스템 확인", "candidate": "문제 후보", "review_required": "검토 필요",
          "incomplete": "미완료", "false_positive": "오탐 판정", "unknown": "미확인",
          "completed": "검사 완료", "not_run": "미실행", "reproduced": "현상 재현됨",
          "not_reproduced": "현상 관찰 안 됨", "failed": "재현 실행 실패",
          "functional": "기능 동작", "validation": "입력 검증", "routing": "이동·라우팅",
          "ui": "UI 표시·조작", "initial": "최초 발견", "reproduction": "추가 재현",
          "executed": "실행됨", "not_executed": "실행 안 됨"}


class EvidenceError(ValueError):
    """Safe local validation message without untrusted filenames or contents."""


def evidence_path(root, ref):
    if not ref or '\\' in ref or ':' in ref or PureWindowsPath(ref).is_absolute() or Path(ref).is_absolute():
        raise EvidenceError("증거는 묶음 내부의 상대 경로여야 합니다")
    root = root.resolve()
    target = (root / ref).resolve()
    if not target.is_relative_to(root):
        raise EvidenceError("증거 폴더 밖의 경로는 읽지 않습니다")
    if not target.is_file():
        raise EvidenceError("증거 파일이 전달되지 않았습니다")
    if target.stat().st_size > 15 * 1024 * 1024:
        raise EvidenceError("증거 파일이 15 MB 제한을 초과합니다")
    return target


def register_font(font=None):
    candidates = [font, os.environ.get("WTP_REPORT_FONT"), "C:/Windows/Fonts/malgun.ttf",
                  "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"]
    selected = next((Path(p) for p in candidates if p and Path(p).is_file()), None)
    if selected is None:
        raise InputError("Korean TTF required: set --font or WTP_REPORT_FONT")
    pdfmetrics.registerFont(TTFont("WTPKorean", str(selected)))


def generate(data, evidence_root, output, font=None):
    validate(data)
    metrics = counts(data)
    safe, scrub = sanitize(data)
    register_font(font)
    styles = {name: ParagraphStyle(name, fontName="WTPKorean", fontSize=size, leading=leading,
                                   textColor=colors.HexColor(color), spaceAfter=after,
                                   wordWrap="CJK", keepWithNext=name in {"title", "heading"})
              for name, size, leading, color, after in [
                  ("title", 25, 34, "#112D43", 18), ("heading", 14, 21, "#125D76", 10),
                  ("body", 9, 15, "#25394B", 7), ("muted", 8, 13, "#526879", 7)]}
    story, warnings, method_warnings = [], [], []

    def p(text, style="body"):
        return Paragraph(escape(str(text)).replace('\n', '<br/>'), styles[style])

    def add(text, style="body"):
        story.append(p(text, style))

    def val(value, pointer):
        if value is None:
            reason = safe["unknown_reasons"].get(pointer, "앞단에서 값과 미확인 사유를 전달하지 않음")
            return "미확인 - " + reason
        return str(value)

    def field(label, value, pointer):
        add(f"{label}  |  {val(value, pointer)}")

    def table(header, entries, widths):
        if not entries:
            add("전달된 기록 없음. 전체 사이트에 문제가 없다는 뜻은 아닙니다.", "muted")
            return
        grid = Table([[p(x, "muted") for x in header]] + [[p(x) for x in row] for row in entries],
                     colWidths=widths, repeatRows=1, hAlign="LEFT", splitInRow=1)
        grid.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E7EFF4")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -1), .4, colors.HexColor("#D7E1E8")),
            ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
            ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
        story.extend([grid, Spacer(1, 14)])

    add("WEBTESTPILOT  /  QA REPORT", "muted")
    add("웹사이트 검사 결과 보고서", "title")
    add("합성 예시 · 실제 사이트 검사 결과 아님" if safe["synthetic"] else "전달된 실행 기록 기반 보고서", "heading")
    add("독립 PDF 프로토타입 | 판정 생성·사이트 재방문·자동 재현을 수행하지 않습니다.", "muted")
    for key, label in [("run_id", "실행 ID"), ("site_url", "대상 URL"),
                       ("started_at", "시작 시간"), ("ended_at", "종료 시간"), ("termination_reason", "종료 이유")]:
        field(label, safe["run"][key], f"/run/{key}")
    field("브라우저", safe["environment"]["browser"], "/environment/browser")
    field("화면 크기", safe["environment"]["viewport"], "/environment/viewport")
    story.append(Spacer(1, 16))
    add("01  실행 요약", "heading")
    table(["검사 기록", "완료 / 미완료·미확인", "문제 기록 / 시스템 확인"],
          [[str(metrics["checks"]), f'{metrics["completed"]} / {metrics["incomplete"]}',
            f'{metrics["findings"]} / {metrics["confirmed"]}']], [169, 169, 169])
    add(f'검사 기록에 URL이 있는 페이지 {metrics["pages"]}개 · 후보·검토·미확인 {metrics["candidates"]}건')
    add("수치는 전달된 고유 검사·문제 ID로 계산합니다. 행동 수와 재현 횟수는 문제 수에 더하지 않습니다. "
        "검사 완료는 통과 또는 사이트 전체 정상 보장을 뜻하지 않습니다. 시스템 확인은 앞단 판정이며 담당자 확인이 아닙니다.", "muted")

    story.append(PageBreak())
    add("02  검사 범위와 미완료 항목", "heading")
    table(["검사 / 페이지", "항목", "상태 / 사유"], [
        [f'{x["check_id"]}\n{val(x["page_url"], f"/checks/{i}/page_url")}',
         val(x["item"], f"/checks/{i}/item"),
         f'{LABELS[x["status"]]}\n{val(x["reason"], f"/checks/{i}/reason")}' ]
        for i, x in enumerate(safe["checks"])], [183, 150, 174])
    add("문제 기록 목록", "heading")
    table(["문제 ID / 발생 페이지", "문제 제목", "앞단 판정"], [
        [f'{x["finding_id"]}\n{val(x["page_url"], f"/findings/{i}/page_url")}',
         val(x["title"], f"/findings/{i}/title"), LABELS[x["status"]]]
        for i, x in enumerate(safe["findings"])], [183, 220, 104])
    action_index = {a["action_id"]: a for a in safe["actions"]}

    def actions(ids):
        if not ids:
            add("행동 순서 미확인 - 연결된 실제 행동이 전달되지 않음", "muted")
            return
        entries = []
        for n, aid in enumerate(ids, 1):
            a = action_index[aid]
            idx = safe["actions"].index(a)
            inputs = "\n".join(item["name"] + ": " + val(item["value"], f"/actions/{idx}/inputs/{j}/value")
                               for j, item in enumerate(a["inputs"]))
            entries.append([str(n), val(a["description"], f"/actions/{idx}/description"),
                            inputs or "입력 기록 없음", f'{LABELS[a["execution"]]}\n{aid}'])
        table(["순서", "기록된 행동", "테스트 입력값", "실행 / 행동 ID"], entries, [34, 223, 125, 125])

    for i, finding in enumerate(safe["findings"]):
        base = f"/findings/{i}"
        story.append(PageBreak())
        add(f'03  문제 상세 / {finding["finding_id"]}', "heading")
        add(val(finding["title"], base + "/title"), "heading")
        for key, label in [("page_url", "발생 페이지"), ("category", "범주"),
                           ("status", "앞단 판정"), ("reason", "판정 사유")]:
            value = LABELS[finding[key]] if key in {"category", "status"} else finding[key]
            field(label, value, base + "/" + key)
        add("기대 동작과 실제 결과", "heading")
        for key, label in [("statement", "기대 동작"), ("source", "기대 근거"), ("source_ref", "근거 참조")]:
            field(label, finding["expected"][key], base + "/expected/" + key)
        field("실제 결과", finding["actual"], base + "/actual")
        refs = [e["evidence_id"] for e in safe["evidence"] if finding["finding_id"] in e["finding_ids"]]
        add("연결 증거: " + (", ".join(refs) or "미확인 - 연결 증거가 전달되지 않음"), "muted")
        story.append(PageBreak())
        add(f'재현 방법 (필수) / {finding["finding_id"]}', "heading")
        add(val(finding["title"], base + "/title"), "heading")
        gaps = []
        for value, label in ((finding["page_url"], "시작 페이지"),
                             (finding["preconditions"], "시작 조건"),
                             (safe["environment"]["browser"], "브라우저"),
                             (safe["environment"]["viewport"], "화면 크기")):
            if not value or not value.strip():
                gaps.append(label + " 미확인")
        if not finding["action_ids"]:
            gaps.append("최초 발견 행동 순서 없음")
        for aid in finding["action_ids"]:
            action = action_index[aid]
            if not action["description"] or not action["description"].strip():
                gaps.append(aid + ": 행동 설명 미확인")
            if action["execution"] != "executed":
                gaps.append(aid + ": 실제 실행 확인 필요")
            for item in action["inputs"]:
                if item["value"] is None:
                    gaps.append(aid + ": 입력값 미확인")
                elif "[비밀값 제외]" in item["value"]:
                    gaps.append(aid + ": 비밀 입력값 제외, 승인된 테스트 값 별도 준비 필요")
        if gaps:
            method_warnings.append({"finding_id": finding["finding_id"], "reasons": gaps})
            add("재현 방법 보완 필요 - " + "; ".join(gaps))
        else:
            add("기본 조건·행동 기록 있음. 독립 재현 가능 여부는 확인하지 않았습니다.", "muted")
        field("시작 페이지", finding["page_url"], base + "/page_url")
        field("브라우저", safe["environment"]["browser"], "/environment/browser")
        field("화면 크기", safe["environment"]["viewport"], "/environment/viewport")
        field("시작 조건", finding["preconditions"], base + "/preconditions")
        add("최초 발견 시 기록된 순서입니다. 실행 안 됨·미확인 단계는 수행한 절차로 간주하지 않습니다.", "muted")
        actions(finding["action_ids"])
        field("확인할 기대 결과", finding["expected"]["statement"], base + "/expected/statement")
        field("최초 관찰 결과", finding["actual"], base + "/actual")
        add("추가 재현 결과", "heading")
        field("재현 결과", LABELS[finding["reproduction"]["status"]], base + "/reproduction/status")
        field("사유", finding["reproduction"]["reason"], base + "/reproduction/reason")
        if finding["reproduction"]["status"] == "not_run":
            add("추가 실행하지 않았습니다. 위 재현 방법과 추가 재현의 성공 여부는 별개입니다.", "muted")
        else:
            actions(finding["reproduction"]["action_ids"])
        add("연결 증거: " + (", ".join(refs) or "미확인 - 연결 증거가 전달되지 않음"), "muted")

    story.append(PageBreak())
    add("04  증거 자료", "heading")
    if not safe["evidence"]:
        add("증거 자료 미확인 - 전달된 증거 기록 없음")
    for i, evidence in enumerate(safe["evidence"]):
        add(f'{evidence["evidence_id"]} / {LABELS[evidence["phase"]]} / {evidence["kind"]}', "heading")
        field("파일", evidence["path"], f"/evidence/{i}/path")
        add("문제: " + (", ".join(evidence["finding_ids"]) or "연결 없음") +
            " | 행동: " + (", ".join(evidence["action_ids"]) or "연결 없음"), "muted")
        try:
            if evidence["path"] is None:
                raise EvidenceError("증거 파일 경로가 전달되지 않았습니다")
            if not evidence["share_safe"]:
                raise EvidenceError("민감정보 검토가 완료되지 않아 증거 내용을 제외했습니다")
            # Resolve original path, never a redacted path. Ref remains untrusted local data.
            path = evidence_path(Path(evidence_root), data["evidence"][i]["path"])
            if evidence["kind"] == "screenshot":
                with PILImage.open(path) as im:
                    if im.width * im.height > 20_000_000:
                        raise EvidenceError("이미지 크기 제한 초과")
                    im.load()
                    buffer = BytesIO()
                    im.convert("RGB").save(buffer, format="PNG")
                    width, height = im.size
                buffer.seek(0)
                scale = min(507 / width, 340 / height, 1)
                story.append(Image(buffer, width=width * scale, height=height * scale, hAlign="LEFT"))
            else:
                raw = path.read_text(encoding="utf-8-sig")
                excerpt = raw[:12000]
                add(scrub(excerpt))
                if len(raw) > len(excerpt):
                    add("로그는 앞 12,000자만 표시합니다. 원본은 증거 묶음에서 확인하세요.", "muted")
        except (OSError, ValueError, PILImage.DecompressionBombError) as error:
            # Detailed exception paths and decoder messages are not safe to publish.
            if isinstance(error, EvidenceError):
                message = str(error)
            else:
                message = "파일 누락·경로 제한·손상·형식 또는 크기 제한으로 표시 불가"
            warnings.append({"evidence_id": evidence["evidence_id"], "reason": message})
            add("증거 미확인 - " + message)
        if evidence["reason"]:
            field("증거 수집 사유", evidence["reason"], f"/evidence/{i}/reason")
        story.append(Spacer(1, 14))

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#D7E1E8"))
        canvas.line(44, 40, A4[0] - 44, 40)
        canvas.setFont("WTPKorean", 8)
        canvas.setFillColor(colors.HexColor("#526879"))
        canvas.drawString(44, 27, "WebTestPilot | 합성 예시" if safe["synthetic"] else "WebTestPilot | 기록 기반 보고서")
        canvas.drawRightString(A4[0] - 44, 27, str(doc.page))
        canvas.restoreState()

    output = Path(output).resolve()
    # Keep evidence and final output separate to preserve the original bundle.
    if output.is_relative_to(Path(evidence_root).resolve()):
        raise InputError("Output must be outside the evidence bundle")
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".wtp-report-", suffix=".pdf", dir=output.parent)
    os.close(fd)
    try:
        document = SimpleDocTemplate(temp, pagesize=A4, rightMargin=44, leftMargin=44,
                                     topMargin=44, bottomMargin=55,
                                     title="WebTestPilot QA Report", author="WebTestPilot")
        document.build(story, onFirstPage=footer, onLaterPages=footer)
        os.replace(temp, output)
    finally:
        Path(temp).unlink(missing_ok=True)
    return {"counts": metrics, "evidence_warnings": warnings, "reproduction_warnings": method_warnings}
