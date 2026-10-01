from __future__ import annotations

import hashlib
import json
import re
from typing import Any

_VOLATILE_TEXT = re.compile(
    r"\b(?:\d{1,2}:\d{2}(?::\d{2})?|(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|[0-9a-f]{8,})\b",
    re.IGNORECASE,
)
_SPACE = re.compile(r"\s+")


# 공백을 정리하고 길이를 제한해 비교하기 쉬운 텍스트로 만든다.
def compact_text(value: str, limit: int = 160) -> str:
    value = _SPACE.sub(" ", value or "").strip()
    value = _VOLATILE_TEXT.sub("{volatile}", value)
    return value[:limit]


# URL과 핵심 시맨틱 요소를 해시해 페이지 상태 식별자를 만든다.
def semantic_fingerprint(normalized_url: str, semantic: dict[str, Any]) -> str:
    stable = {
        "url": normalized_url,
        "title": compact_text(str(semantic.get("title", ""))),
        "headings": sorted(compact_text(str(item)) for item in semantic.get("headings", [])),
        "controls": sorted(
            (
                str(item.get("kind", "")),
                compact_text(str(item.get("label", ""))),
                str(item.get("expanded", "")),
            )
            for item in semantic.get("controls", [])
        ),
        "inputs": sorted(
            (
                str(item.get("type", "")),
                compact_text(str(item.get("label", ""))),
                compact_text(str(item.get("placeholder", ""))),
            )
            for item in semantic.get("inputs", [])
        ),
        "links": sorted(
            (compact_text(str(item.get("text", ""))), str(item.get("href", "")))
            for item in semantic.get("links", [])
        ),
        "dialogs": sorted(compact_text(str(item)) for item in semantic.get("dialogs", [])),
        "text": compact_text(str(semantic.get("text", "")), 600),
    }
    raw = json.dumps(stable, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


# 브라우저 DOM에서 링크·컨트롤·폼·오류 판단용 시맨틱 스냅샷을 수집한다.
async def collect_semantic_snapshot(page: Any, max_text_chars: int = 2_000) -> dict[str, Any]:
    """Collect a compact, role-oriented DOM view without serializing the full HTML."""

    return await page.evaluate(
        """
        (maxText) => {
          const visible = (el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' &&
                   rect.width > 0 && rect.height > 0;
          };
          const label = (el) => (
            el.getAttribute('aria-label') ||
            el.labels?.[0]?.innerText ||
            el.innerText || el.value || el.title || el.placeholder || ''
          ).replace(/\\s+/g, ' ').trim().slice(0, 160);
          const assignId = (el, prefix, index) => {
            if (!el.dataset.wtpId) el.dataset.wtpId = `${prefix}-${index}`;
            return `[data-wtp-id="${el.dataset.wtpId}"]`;
          };

          const links = [...document.querySelectorAll('a[href]')]
            .filter(visible).slice(0, 250)
            .map((el) => ({text: label(el), href: el.href}));
          const controls = [...document.querySelectorAll(
            'button,[role="button"],[role="tab"],[role="menuitem"],summary,input[type="button"],input[type="submit"],[aria-haspopup]'
          )].filter(visible).slice(0, 120).map((el, index) => ({
            selector: assignId(el, 'control', index),
            kind: el.getAttribute('role') || el.tagName.toLowerCase(),
            label: label(el),
            expanded: el.getAttribute('aria-expanded'),
            hasPopup: el.getAttribute('aria-haspopup'),
            formSubmit: Boolean(el.form) && (
                        (el.tagName === 'BUTTON' && (el.type || 'submit') === 'submit') ||
                        (el.tagName === 'INPUT' && el.type === 'submit')),
            disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true'
          }));
          const hoverControls = [...document.querySelectorAll(
            '[aria-haspopup],[data-tooltip],[data-tooltip-content],[title]'
          )].filter(visible).slice(0, 80).map((el, index) => ({
            selector: assignId(el, 'hover', index),
            kind: 'hover', label: label(el), expanded: el.getAttribute('aria-expanded'),
            hasPopup: el.getAttribute('aria-haspopup'), formSubmit: false,
            disabled: Boolean(el.disabled)
          }));
          const inputs = [...document.querySelectorAll('input,textarea,select')]
            .filter(visible).slice(0, 120).map((el) => ({
              type: el.type || el.tagName.toLowerCase(), label: label(el),
              placeholder: el.placeholder || '', required: Boolean(el.required)
            }));
          const headings = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
            .filter(visible).slice(0, 80).map((el) => label(el));
          const dialogs = [...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]')]
            .filter(visible).slice(0, 20).map((el) => label(el));
          const brokenImages = [...document.images]
            .filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.currentSrc || img.src);
          const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, maxText);
          return {
            title: document.title, headings, controls, hoverControls, inputs, links, dialogs,
            brokenImages, text: bodyText,
            forms: document.forms.length, images: document.images.length,
            scripts: document.scripts.length,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth
          };
        }
        """,
        max_text_chars,
    )
