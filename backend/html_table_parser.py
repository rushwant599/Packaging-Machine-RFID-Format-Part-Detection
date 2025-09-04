"""HTML Main Table Row Extractor

Provides a small utility to read the cached customer HTML file and
extract every <tr> element contained in the <table class="main"> while
preserving the original order.

Returned rows can be provided either as raw HTML strings (default) or as
simple text representations.

Usage:
    extractor = MainTableRowExtractor(path_to_html)
    rows = extractor.extract_rows(as_html=True)

The implementation is intentionally light‑weight and stateless; call it
on demand so the endpoint always reflects the latest uploaded file.
"""

from __future__ import annotations

from pathlib import Path
from typing import List, Dict, Any
from bs4 import BeautifulSoup


class MainTableRowExtractor:
    """Extract all <tr> blocks from <table class="main"> in order.

    Parameters
    ----------
    html_file_path: str | Path
        Path to the cached HTML file.
    """

    def __init__(self, html_file_path: str | Path):
        self.html_file_path = Path(html_file_path)

    # Public API -----------------------------------------------------
    def extract_rows(self, *, as_html: bool = True, strip_whitespace: bool = False,
                     with_meta: bool = False, duplicate_caption: bool = False) -> List[Any]:  # duplicate_caption kept for backward compatibility
        """Return all table row blocks preserving order.

        Parameters
        ----------
        as_html: bool
            When True (default) return the full HTML of each <tr> including
            its attributes and children. When False return a plain text
            concatenation (cells separated by a single space).
        strip_whitespace: bool
            If True and as_html=True, leading/trailing whitespace around the
            serialized row string is stripped.
        """
        soup = self._load_soup()
        table = soup.find("table", class_="main")
        if not table:
            return []
        rows = table.find_all("tr")

        # Pre-collect caption only rows (class 'caption' but NOT 'line') for optional duplication (legacy behavior)
        caption_only_rows = [r for r in rows if 'caption' in (r.get('class') or []) and 'line' not in (r.get('class') or [])]

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

    # Internal helpers -----------------------------------------------
    def _load_soup(self) -> BeautifulSoup:
        if not self.html_file_path.exists():
            raise FileNotFoundError(f"HTML cache file not found: {self.html_file_path}")
        content = self.html_file_path.read_text(encoding="utf-8", errors="ignore")
        return BeautifulSoup(content, "html.parser")


__all__ = ["MainTableRowExtractor"]
