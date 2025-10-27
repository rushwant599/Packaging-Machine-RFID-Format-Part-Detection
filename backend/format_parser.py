import re
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

NO_HTML_FILE_MESSAGE = "No HTML file uploaded"

# Main Parser Class
class FormatDataParser:
    
    # Initialization
    def __init__(self, html_file_path: str):
        self.html_file_path = Path(html_file_path)
        self._preferred_path = self._resolve_preferred_path(self.html_file_path)

    # Resolve preferred path
    def _resolve_preferred_path(self, path: Path) -> Path:
        try:
            injected_names = {
                "customer-html-cache.html",
                "customer-html-cache.injected.html",
            }
            if path.name in injected_names:
                original = path.with_name("customer-html-cache.original.html")
                if original.exists():
                    return original
        except Exception:
            pass
        return path
    
    # Main parsing method
    def parse(self) -> Dict[str, Any]:
        try:
            html_content = self._read_html_file()
            soup = BeautifulSoup(html_content, 'html.parser')
            
            script_content = self._extract_script_content(soup)
            if not script_content:
                logger.warning("No script content found in HTML file")
                return {}
            
            formats_json_str = self._extract_formats_json(script_content)
            if not formats_json_str:
                logger.warning("No formats JSON found in script content")
                return {}
            
            formats_data = self._parse_formats_json(formats_json_str)
            if not formats_data:
                return {}

            value_index_map = self._build_value_index_map(soup)

            collected = self._collect_all_parts(formats_data, value_index_map)

            format_data = {
                'formats': formats_data,
                'formatParts': collected['combinedParts'],
                'formatPartsRaw': collected['rawParts'],
                'formatPartsPerFormat': collected['rawPerFormat'],
                'formatPartsPerFormatWithIndex': collected['combinedPerFormat'],
                'valueIndexMap': value_index_map
            }
            
            logger.info(f"Successfully parsed {len(formats_data)} formats with {len(format_data['formatParts'])} unique parts")
            return format_data
            
        except FileNotFoundError as e:
            logger.error(f"HTML file not found: {e}")
            raise
        except Exception as e:
            logger.error(f"Error parsing format data: {e}")
            raise
    
    # Get only the format parts data
    def get_format_parts_only(self) -> List[str]:
        try:
            format_data = self.parse()
            return format_data.get('formatParts', [])
        except Exception as e:
            logger.error(f"Error getting format parts: {e}")
            return []

    # Get only the formats data
    def get_formats_only(self) -> Dict[str, Any]:
        try:
            format_data = self.parse()
            return format_data.get('formats', {})
        except Exception as e:
            logger.error(f"Error getting formats: {e}")
            return {}

    # Get only the format parts per format
    def get_format_parts_per_format(self) -> Dict[str, List[str]]:
        try:
            format_data = self.parse()
            return format_data.get('formatPartsPerFormat', {})
        except Exception as e:
            logger.error(f"Error getting format parts per format: {e}")
            return {}

    # Read HTML file content
    def _read_html_file(self) -> str:
        path = getattr(self, "_preferred_path", self.html_file_path)
        if not path.exists():
            raise FileNotFoundError(f"Die Datei '{path}' wurde nicht gefunden.")
        
        try:
            with open(path, 'r', encoding='utf-8') as file:
                return file.read()
        except Exception as e:
            raise IOError(f"Fehler beim Lesen der Datei '{path}': {e}")
    
    # Extract script content
    def _extract_script_content(self, soup: BeautifulSoup) -> Optional[str]:
        script_element = soup.find(id="FormatData")
        if not script_element:
            logger.warning("FormatData script element not found")
            return None
        
        script_content = script_element.get_text(strip=True)
        cleaned_content = re.sub(r'[\u0000-\u001F\u007F-\u009F]', '', script_content)
        return cleaned_content
    
    # Extract formats JSON from script content
    def _extract_formats_json(self, script_content: str) -> Optional[str]:
        pattern = r'var\s+formats\s*=\s*({[\s\S]*?});'
        match = re.search(pattern, script_content)
        
        if not match:
            logger.warning("No formats variable found in script content")
            return None
        
        return match.group(1)
    
    # Parse formats JSON string
    def _parse_formats_json(self, json_str: str) -> Optional[Dict[str, Any]]:
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
            raise ValueError(f"Fehler beim Parsen von JSON: {e}")
    
    # Build value index map
    def _build_value_index_map(self, soup: BeautifulSoup) -> Dict[int, str]:
        mapping: Dict[int, str] = {}
        for value_cell in soup.select('td[id^="v"], td[id^="v"]'):
            vid = value_cell.get('id')
            if not vid:
                continue
            m = re.match(r'^v(\d+)$', vid)
            if not m:
                continue
            data_pos = int(m.group(1))
            row = value_cell.parent
            if not row:
                continue
            idx_cell = row.find('td', class_='value index')
            if not idx_cell:
                continue
            displayed = (idx_cell.get_text(strip=True) or '').strip()
            if displayed:
                mapping[data_pos] = displayed
        return mapping

    # Collect all format parts
    def _collect_all_parts(self, formats_data: Dict[str, Any], value_index_map: Dict[int, str]) -> Dict[str, Any]:
        
        # Compute order key
        def compute_order_key(idx: int, visible_idx: Optional[str]) -> int:
            if visible_idx and visible_idx.isdigit():
                return int(visible_idx)
            return 10_000_000 + idx

        # Extract item info
        def extract_item(idx: int, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            part = (item.get("formatPart") or "").strip()
            if not part or re.match(r'^-+$', part):
                return None
            visible_idx = value_index_map.get(idx) if idx > 0 else None
            if part == "FTL." and not visible_idx:
                return None
            order_key = compute_order_key(idx, visible_idx)
            combined = f"{visible_idx} {part}" if visible_idx else part
            if visible_idx and 'valueIndex' not in item:
                item['valueIndex'] = visible_idx
            if 'combinedPart' not in item:
                item['combinedPart'] = combined
            return {'part': part, 'combined': combined, 'order': order_key}

        # Process format data items
        def process_format(data_items: List[Any]) -> List[Dict[str, Any]]:
            processed: List[Dict[str, Any]] = []
            for idx, item in enumerate(data_items):
                if not isinstance(item, dict):
                    continue
                info = extract_item(idx, item)
                if info:
                    processed.append(info)
            return processed

        # Collect all parts
        raw_parts_global: set[str] = set()
        combined_index_map: Dict[str, int] = {}
        raw_per_format: Dict[str, List[str]] = {}
        combined_per_format: Dict[str, List[str]] = {}

        for format_name, fmt in formats_data.items():
            data_items = fmt.get("data", [])
            if not isinstance(data_items, list):
                continue
            processed_items = process_format(data_items)
            local_raw: set[str] = set()
            local_combined_map: Dict[str, int] = {}
            for info in processed_items:
                p = info['part']
                c = info['combined']
                o = info['order']
                raw_parts_global.add(p)
                local_raw.add(p)
                if c not in combined_index_map or o < combined_index_map[c]:
                    combined_index_map[c] = o
                if c not in local_combined_map or o < local_combined_map[c]:
                    local_combined_map[c] = o
            raw_per_format[format_name] = sorted(local_raw)
            combined_per_format[format_name] = [c for c, _ in sorted(local_combined_map.items(), key=lambda kv: (kv[1], kv[0]))]

        combined_parts_ordered = [c for c, _ in sorted(combined_index_map.items(), key=lambda kv: (kv[1], kv[0]))]
        return {
            'rawParts': sorted(raw_parts_global),
            'combinedParts': combined_parts_ordered,
            'rawPerFormat': raw_per_format,
            'combinedPerFormat': combined_per_format
        }

# Legacy function for backward compatibility
def parse_format_data_from_file(filepath: str) -> Dict[str, Any]:
    """
    Legacy function for backward compatibility
    Parse format data from HTML file
    """
    parser = FormatDataParser(filepath)
    return parser.parse()

# High-level Format Data Manager
class FormatDataManager:
    
    # Initialization
    def __init__(self, cache_file_path: str):
        self.cache_file_path = Path(cache_file_path)
        self._parser: Optional[FormatDataParser] = None
    
    # Get or create parser instance
    def _get_parser(self) -> FormatDataParser:
        if self._parser is None:
            self._parser = FormatDataParser(str(self.cache_file_path))
        return self._parser

    # Check if the cache file exists
    def file_exists(self) -> bool:
        return self.cache_file_path.exists()
    
    # Public API methods
    # Get full format data
    def get_format_data(self) -> Dict[str, Any]:
        if not self.file_exists():
            return {}
        
        try:
            return self._get_parser().parse()
        except Exception as e:
            logger.error(f"Error getting format data: {e}")
            return {}
    
    # Get format parts with metadata
    def get_format_parts(self) -> Dict[str, Any]:
        if not self.file_exists():
            return {
                "formatParts": [],
                "count": 0,
                "message": NO_HTML_FILE_MESSAGE
            }
        
        try:
            format_parts = self._get_parser().get_format_parts_only()
            return {
                "formatParts": format_parts,
                "count": len(format_parts),
                "message": f"Found {len(format_parts)} unique format parts"
            }
        except Exception as e:
            logger.error(f"Error getting format parts: {e}")
            return {
                "formatParts": [],
                "count": 0,
                "error": str(e)
            }
    
    # Get formats with metadata
    def get_formats(self) -> Dict[str, Any]:
        if not self.file_exists():
            return {
                "formats": {},
                "formatNames": [],
                "count": 0,
                "message": NO_HTML_FILE_MESSAGE
            }
        try:
            formats = self._get_parser().get_formats_only()
            return {
                "formats": formats,
                "formatNames": list(formats.keys()),
                "count": len(formats),
                "message": f"Found {len(formats)} formats"
            }
        except Exception as e:
            logger.error(f"Error getting formats: {e}")
            return {
                "formats": {},
                "formatNames": [],
                "count": 0,
                "error": str(e)
            }
    
    # Get format parts per format with metadata
    def get_format_parts_per_format(self) -> Dict[str, Any]:
        if not self.file_exists():
            return {
                "formatPartsPerFormat": {},
                "formatCount": 0,
                "message": NO_HTML_FILE_MESSAGE
            }
        try:
            format_parts_per_format = self._get_parser().get_format_parts_per_format()
            return {
                "formatPartsPerFormat": format_parts_per_format,
                "formatCount": len(format_parts_per_format),
                "message": f"Found parts for {len(format_parts_per_format)} formats"
            }
        except Exception as e:
            logger.error(f"Error getting format parts per format: {e}")
            return {
                "formatPartsPerFormat": {},
                "formatCount": 0,
                "error": str(e)
            }

    # Get format parts per format with index
    def get_format_parts_per_format_with_index(self) -> Dict[str, Any]:
        if not self.file_exists():
            return {
                "formatPartsPerFormatWithIndex": {},
                "formatCount": 0,
                "message": NO_HTML_FILE_MESSAGE
            }
        try:
            data = self._get_parser().parse()
            per_format = data.get('formatPartsPerFormatWithIndex', {})
            return {
                "formatPartsPerFormatWithIndex": per_format,
                "formatCount": len(per_format),
                "message": f"Found indexed parts for {len(per_format)} formats"
            }
        except Exception as e:
            logger.error(f"Error getting format parts per format with index: {e}")
            return {
                "formatPartsPerFormatWithIndex": {},
                "formatCount": 0,
                "error": str(e)
            }
