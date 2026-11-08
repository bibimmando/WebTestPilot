"""Render user-supplied document blocks; never infer defects or calculate scores."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from xml.sax.saxutils import escape


# JSON에 비표준 수치가 들어오면 조용히 유효한 결과로 바꾸지 않는다.
def load_document(path):
    def reject(value):
        raise ValueError('Non-finite JSON constant: ' + value)
    return json.loads(path.read_text(encoding='utf-8-sig'), parse_constant=reject)


# 문서 내용과 무관하게 표현 형식의 필수 조건만 검사한다.
def validate_document(doc, base):
    if not isinstance(doc, dict) or doc.get('format') != 'qa-comparison-document/1':
        raise ValueError('Expected format qa-comparison-document/1')
    if not isinstance(doc.get('title'), str) or not doc['title'].strip():
        raise ValueError('A nonempty title is required')
    for name in ('subtitle', 'footer'):
        if not isinstance(doc.get(name, ''), str):
            raise ValueError(name + ' must be text')
    metadata = doc.get('metadata', [])
    headers = doc.get('metadata_headers', ['항목', '내용'])
    if not isinstance(headers, list) or len(headers) != 2 or not all(isinstance(v, str) for v in headers):
        raise ValueError('metadata_headers must contain two strings')
    if not isinstance(metadata, list) or any(not isinstance(row, list) or len(row) != 2 or
            not all(isinstance(v, str) for v in row) for row in metadata):
        raise ValueError('metadata must be a list of two-string rows')
    sections = doc.get('sections')
    if not isinstance(sections, list) or not sections:
        raise ValueError('Fill sections before rendering; the empty template is not a report')
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get('title'), str):
            raise ValueError('Each section needs a text title')
        if type(section.get('new_page', False)) is not bool:
            raise ValueError('new_page must be boolean')
        blocks = section.get('blocks')
        if not isinstance(blocks, list) or not blocks:
            raise ValueError('Each section needs nonempty blocks')
        for block in blocks:
            if not isinstance(block, dict):
                raise ValueError('Each block must be an object')
            kind = block.get('type')
            if kind in ('paragraph', 'note'):
                if not isinstance(block.get('text'), str):
                    raise ValueError('Text blocks need text')
            elif kind == 'table':
                headers, rows = block.get('headers'), block.get('rows')
                if not isinstance(headers, list) or not headers or not all(isinstance(h, str) for h in headers):
                    raise ValueError('Table headers must be a nonempty string list')
                if not isinstance(rows, list) or any(not isinstance(row, list) or len(row) != len(headers) for row in rows):
                    raise ValueError('Every table row must match the header column count')
                if any(not isinstance(v, (str, int, float)) or isinstance(v, bool) or
                       isinstance(v, float) and not math.isfinite(v) for row in rows for v in row):
                    raise ValueError('Table cells must be text or finite numbers')
                weights = block.get('widths', [1] * len(headers))
                if not isinstance(weights, list) or len(weights) != len(headers) or any(
                        type(w) not in (int, float) or not math.isfinite(w) or w <= 0 for w in weights):
                    raise ValueError('Table widths must be positive finite column weights')
            elif kind == 'image':
                if not isinstance(block.get('path'), str) or not block['path']:
                    raise ValueError('Image needs a local path')
                if not (base / block['path']).is_file():
                    raise ValueError('Image file not found: ' + block['path'])
                if not isinstance(block.get('caption', ''), str):
                    raise ValueError('Image caption must be text')
                height = block.get('max_height', 260)
                if type(height) not in (int, float) or not math.isfinite(height) or not 0 < height <= 600:
                    raise ValueError('max_height must be between 0 and 600 points')
            elif kind == 'bars':
                rows = block.get('rows')
                if not isinstance(rows, list) or not rows:
                    raise ValueError('bars needs rows')
                for row in rows:
                    if not isinstance(row, dict) or not isinstance(row.get('label'), str):
                        raise ValueError('Each bar needs a label')
                    if any(type(row.get(key)) not in (int, float) or not math.isfinite(row[key]) for key in ('value', 'total')):
                        raise ValueError('Bar value/total must be finite numbers')
                    if not 0 <= row['value'] <= row['total'] or row['total'] <= 0:
                        raise ValueError('Bar requires 0 <= value <= total and total > 0')
            else:
                raise ValueError('Unsupported block type: ' + str(kind))


# 일반적인 한글 글꼴 위치를 시도하고 없으면 명시적 글꼴 지정을 요구한다.
def resolve_fonts(regular=None, bold=None):
    if regular:
        regular = Path(regular).resolve()
        bold = Path(bold).resolve() if bold else regular
    else:
        windir = Path(os.environ.get('WINDIR', 'C:/Windows'))
        candidates = [(windir/'Fonts/malgun.ttf', windir/'Fonts/malgunbd.ttf'),
                      (Path('/usr/share/fonts/truetype/nanum/NanumGothic.ttf'), Path('/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf'))]
        chosen = next(((a, b) for a, b in candidates if a.is_file()), None)
        if chosen is None:
            raise ValueError('Provide --font with a Unicode TTF font supporting the report language')
        regular, bold = chosen
        if not bold.is_file():
            bold = regular
    if not regular.is_file() or not bold.is_file():
        raise ValueError('Font file not found')
    return regular, bold


# 입력으로 제공된 본문·표·그림·막대를 공통 지면에 배치한다.
def render(doc, base, output, fonts):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Image, Spacer, PageBreak
    from reportlab.lib.utils import ImageReader

    pdfmetrics.registerFont(TTFont('ReportRegular', str(fonts[0])))
    pdfmetrics.registerFont(TTFont('ReportBold', str(fonts[1])))
    navy, teal = colors.HexColor('#142C40'), colors.HexColor('#007D83')
    gray, pale = colors.HexColor('#536579'), colors.HexColor('#F3F7FA')
    border = colors.HexColor('#D6E0E6')
    width = A4[0] - 88
    common = dict(fontName='ReportRegular', wordWrap='CJK', textColor=navy)
    styles = {
        'body': ParagraphStyle('Body', fontSize=9.3, leading=15, spaceAfter=8, **common),
        'note': ParagraphStyle('Note', fontSize=7.8, leading=12, spaceAfter=7, **{**common, 'textColor': gray}),
        'title': ParagraphStyle('Title', fontName='ReportBold', fontSize=22, leading=30, spaceAfter=13, textColor=navy, wordWrap='CJK'),
        'section': ParagraphStyle('Section', fontName='ReportBold', fontSize=14, leading=21, spaceBefore=12, spaceAfter=9, textColor=teal, wordWrap='CJK'),
        'cell': ParagraphStyle('Cell', fontSize=8.4, leading=12.7, **common),
        'header': ParagraphStyle('Header', fontName='ReportBold', fontSize=8.4, leading=13, textColor=colors.white, wordWrap='CJK')}

    # 마크업과 줄바꿈을 내용 그대로 보존하며 자동 의미 해석을 하지 않는다.
    def paragraph(text, style='body'):
        return Paragraph(escape(str(text)).replace('\n', '<br/>'), styles[style])

    # 같은 폭 계산과 반복 머리말을 모든 표에 적용한다.
    def make_table(headers, rows, weights):
        data = [[paragraph(v, 'header') for v in headers]] + [[paragraph(v, 'cell') for v in row] for row in rows]
        table = Table(data, colWidths=[width*w/sum(weights) for w in weights], repeatRows=1, splitInRow=1, hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), navy), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
            ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LINEBELOW', (0, 0), (-1, -1), .35, border),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, pale])]))
        return table

    story = [paragraph(doc['title'], 'title')]
    if doc.get('subtitle'):
        story.append(paragraph(doc['subtitle'], 'note'))
    if doc.get('metadata'):
        story.extend([make_table(doc.get('metadata_headers', ['항목', '내용']), doc['metadata'], [1, 3]), Spacer(1, 9)])
    for section in doc['sections']:
        if section.get('new_page'):
            story.append(PageBreak())
        if section['title']:
            story.append(paragraph(section['title'], 'section'))
        for block in section['blocks']:
            kind = block['type']
            if kind in ('paragraph', 'note'):
                story.append(paragraph(block['text'], 'body' if kind == 'paragraph' else 'note'))
            elif kind == 'table':
                story.extend([make_table(block['headers'], block['rows'], block.get('widths', [1]*len(block['headers']))), Spacer(1, 9)])
            elif kind == 'image':
                path = base / block['path']
                w, h = ImageReader(str(path)).getSize()
                scale = min(width/w, block.get('max_height', 260)/h)
                story.append(Image(str(path), width=w*scale, height=h*scale, hAlign='CENTER'))
                if block.get('caption'):
                    story.append(paragraph(block['caption'], 'note'))
                story.append(Spacer(1, 7))
            else:
                # 작은 벡터 막대도 행 단위 Flowable로 나눠 페이지 분할을 허용한다.
                from reportlab.graphics.shapes import Drawing, Rect
                for row in block['rows']:
                    story.append(paragraph(f"{row['label']}: {row['value']:g} / {row['total']:g}", 'note'))
                    drawing = Drawing(width, 20)
                    drawing.add(Rect(0, 4, width, 12, fillColor=pale, strokeColor=None))
                    drawing.add(Rect(0, 4, width*row['value']/row['total'], 12, fillColor=teal, strokeColor=None))
                    story.extend([drawing, Spacer(1, 5)])

    class NumberedCanvas(canvas.Canvas):
        # 총 페이지 수를 마지막에 알 수 있도록 페이지 상태를 보존한다.
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.states = []

        # 페이지 내용을 지우지 않고 다음 페이지 상태로 진행한다.
        def showPage(self):
            self.states.append(dict(self.__dict__))
            self._startPage()

        # 최종 페이지 번호와 짧은 footer를 고정된 여백에 기록한다.
        def save(self):
            total = len(self.states)
            for state in self.states:
                self.__dict__.update(state)
                self.setStrokeColor(border)
                self.line(44, 42, A4[0]-44, 42)
                self.setFont('ReportRegular', 7.4)
                self.setFillColor(gray)
                footer = doc.get('footer', '')
                while footer and pdfmetrics.stringWidth(footer, 'ReportRegular', 7.4) > width-75:
                    footer = footer[:-1]
                self.drawString(44, 29, footer)
                self.drawRightString(A4[0]-44, 29, f'{self._pageNumber} / {total}')
                canvas.Canvas.showPage(self)
            canvas.Canvas.save(self)

    output.parent.mkdir(parents=True, exist_ok=True)
    SimpleDocTemplate(str(output), pagesize=A4, leftMargin=44, rightMargin=44, topMargin=43,
        bottomMargin=56, title=doc['title'], author='QA comparison review').build(story, canvasmaker=NumberedCanvas)


# 렌더링과 추적 메타데이터 저장을 명시적으로 호출할 때만 수행한다.
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--font')
    parser.add_argument('--bold-font')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)
    source, output = Path(args.input).resolve(), Path(args.out).resolve()
    sidecar = output.with_suffix('.render.json')
    try:
        if output.suffix.lower() != '.pdf' or output == source:
            raise ValueError('Output must be a separate .pdf file')
        if not args.overwrite and (output.exists() or sidecar.exists()):
            raise ValueError('Output exists; use --overwrite to replace it')
        doc = load_document(source)
        validate_document(doc, source.parent)
        fonts = resolve_fonts(args.font, args.bold_font)
        from pypdf import PdfReader
        render(doc, source.parent, output, fonts)
        metadata = {'format': 'qa-document-render/1', 'input_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'pages': len(PdfReader(output).pages),
            'fonts': [str(f) for f in fonts], 'semantic_verification': 'not performed by renderer'}
        sidecar.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps({'pdf': str(output), 'pages': metadata['pages'], 'metadata': str(sidecar)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
