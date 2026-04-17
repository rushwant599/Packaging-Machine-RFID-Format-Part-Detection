from __future__ import annotations

import re
from pathlib import Path
from typing import List, Dict, Any
from bs4 import BeautifulSoup


# Main Table Row Extractor
class MainTableRowExtractor:

    # Initialization
    def __init__(self, html_file_path: str | Path):
        self.html_file_path = Path(html_file_path)
        self._preferred_path = self._resolve_preferred_path(self.html_file_path)

    # Internal helper to resolve preferred path
    def _resolve_preferred_path(self, path: Path) -> Path:
        try:
            m = re.match(r"^(customer-html-cache)(?:\.([a-z0-9_-]+))?(?:\.(injected|original))?\.html$", path.name)
            if m:
                base = m.group(1)
                lang = m.group(2)
                variant = m.group(3)
                if variant == "original":
                    return path
                if lang:
                    original = path.with_name(f"{base}.{lang}.original.html")
                else:
                    original = path.with_name(f"{base}.original.html")
                if original.exists():
                    return original
        except Exception:
            pass
        return path

    # Public API 
    def extract_rows(self, *, as_html: bool = True, strip_whitespace: bool = False,
                     with_meta: bool = False, duplicate_caption: bool = False) -> List[Any]:
        soup = self._load_soup()
        table = soup.find("table", class_="main")
        if not table:
            return []
        rows = table.find_all("tr")

        caption_only_rows = [r for r in rows if 'caption' in (r.get('class') or []) and 'line' not in (r.get('class') or [])]

        # Serializer function
        def serialize_tr(row) -> Dict[str, Any]:
            classes = row.get('class') or []
            is_caption = 'caption' in classes
            is_line = 'line' in classes
            if is_caption and is_line:
                row_type = 'caption_line'
            elif is_caption:
                row_type = 'caption'
            else:
                row_type = 'data'
            if as_html:
                row_html = str(row)
                if strip_whitespace:
                    row_html = row_html.strip()
            else:
                cells_text = []
                for cell in row.find_all(["td", "th"], recursive=False):
                    cell_text = cell.get_text(strip=True)
                    if cell_text:
                        cells_text.append(cell_text)
                row_html = " ".join(cells_text)
            if with_meta:
                cells_list: List[str] = []
                for cell in row.find_all(["td", "th"], recursive=False):
                    cells_list.append(cell.get_text(strip=True))
                return {
                    ("html" if as_html else "text"): row_html,
                    "text": row.get_text(" ", strip=True),
                    "classes": classes,
                    "is_caption": is_caption,
                    "is_line": is_line,
                    "row_type": row_type,
                    "cells": cells_list,
                }
            return row_html

        result: List[Any] = []
        for row in rows:
            classes = row.get('class') or []
            item = serialize_tr(row)
            result.append(item)
            if duplicate_caption and 'caption' in classes and 'line' in classes and caption_only_rows:
                for cap in caption_only_rows:
                    result.append(serialize_tr(cap))
        return result

    # Internal helpers 
    def _load_soup(self) -> BeautifulSoup:
        path = getattr(self, "_preferred_path", self.html_file_path)
        if not path.exists():
            raise FileNotFoundError(f"HTML cache file not found: {path}")
        content = path.read_text(encoding="utf-8", errors="ignore")
        return BeautifulSoup(content, "html.parser")


__all__ = ["MainTableRowExtractor"]
