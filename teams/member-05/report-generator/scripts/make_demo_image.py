"""Create a visibly synthetic layout fixture, never real inspection evidence."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
font = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 28)
small = ImageFont.truetype("C:/Windows/Fonts/malgun.ttf", 22)
image = Image.new("RGB", (1000, 380), "#edf3f7")
draw = ImageDraw.Draw(image)
draw.rectangle((0, 0, 1000, 66), fill="#18374d")
draw.text((28, 15), "SYNTHETIC FIXTURE / 실제 사이트 증거 아님", font=font, fill="white")
draw.text((36, 95), "PDF 이미지·캡션 배치 검수용", font=font, fill="#18374d")
draw.rounded_rectangle((36, 158, 256, 214), radius=8, fill="#186c88")
draw.text((64, 170), "예시 버튼 영역", font=small, fill="white")
draw.rectangle((36, 248, 963, 340), outline="#91a8b8", width=2)
draw.text((60, 274), "실제 화면·버그 관찰·재현 성공을 나타내지 않습니다.", font=small, fill="#435c6d")
image.save(root / "examples/demo/evidence/demo-layout.png")
