"""
HTML Format Data Parser Module
Handles parsing of format data from customer HTML cache files.
"""

import os
import re
import json
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


class FormatDataParser:
    """Parser for extracting format data from HTML files"""
    
    def __init__(self, html_file_path: str):
        self.html_file_path = Path(html_file_path)
    
    def parse(self) -> Dict[str, Any]:
        """Main parsing method - returns complete format data"""
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
            
            # Build complete format data structure
            format_data = {
                'formats': formats_data,
                'formatParts': self._collect_format_parts(formats_data),
                'formatPartsPerFormat': self._collect_format_parts_per_format(formats_data)
            }
            
            logger.info(f"Successfully parsed {len(formats_data)} formats with {len(format_data['formatParts'])} unique parts")
            return format_data
            
        except FileNotFoundError as e:
            logger.error(f"HTML file not found: {e}")
            raise
        except Exception as e:
            logger.error(f"Error parsing format data: {e}")
            raise
    
    def get_format_parts_only(self) -> List[str]:
        """Get only the format parts list"""
        try:
            format_data = self.parse()
            return format_data.get('formatParts', [])
        except Exception as e:
            logger.error(f"Error getting format parts: {e}")
            return []
    
    def get_formats_only(self) -> Dict[str, Any]:
        """Get only the formats data"""
        try:
            format_data = self.parse()
            return format_data.get('formats', {})
        except Exception as e:
            logger.error(f"Error getting formats: {e}")
            return {}
    
    def get_format_parts_per_format(self) -> Dict[str, List[str]]:
        """Get format parts grouped by format"""
        try:
            format_data = self.parse()
            return format_data.get('formatPartsPerFormat', {})
        except Exception as e:
            logger.error(f"Error getting format parts per format: {e}")
            return {}
    
    def _read_html_file(self) -> str:
        """Read HTML file content"""
        if not self.html_file_path.exists():
            raise FileNotFoundError(f"Die Datei '{self.html_file_path}' wurde nicht gefunden.")
        
        try:
            with open(self.html_file_path, 'r', encoding='utf-8') as file:
                return file.read()
        except Exception as e:
            raise IOError(f"Fehler beim Lesen der Datei '{self.html_file_path}': {e}")
    
    def _extract_script_content(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract script content from FormatData element"""
        script_element = soup.find(id="FormatData")
        if not script_element:
            logger.warning("FormatData script element not found")
            return None
        
        script_content = script_element.get_text(strip=True)
        # Remove control characters
        cleaned_content = re.sub(r'[\u0000-\u001F\u007F-\u009F]', '', script_content)
        return cleaned_content
    
    def _extract_formats_json(self, script_content: str) -> Optional[str]:
        """Extract formats JSON from script content"""
        pattern = r'var\s+formats\s*=\s*({[\s\S]*?});'
        match = re.search(pattern, script_content)
        
        if not match:
            logger.warning("No formats variable found in script content")
            return None
        
        return match.group(1)
    
    def _parse_formats_json(self, json_str: str) -> Optional[Dict[str, Any]]:
        """Parse the formats JSON string"""
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
            raise ValueError(f"Fehler beim Parsen von JSON: {e}")
    
    def _collect_format_parts(self, formats_data: Dict[str, Any]) -> List[str]:
        """Collect all unique format parts"""
        format_parts_set = set()
        
        for format_name, fmt in formats_data.items():
            data_items = fmt.get("data", [])
            if not isinstance(data_items, list):
                logger.warning(f"Invalid data format for {format_name}")
                continue
            
            for item in data_items:
                part = item.get("formatPart")
                if not part:
                    continue
                
                part = part.strip()
                
                # Skip invalid/empty parts
                if part == "FTL." or re.match(r'^-+$', part):
                    continue
                
                format_parts_set.add(part)
        
        return sorted(format_parts_set)
    
    def _collect_format_parts_per_format(self, formats_data: Dict[str, Any]) -> Dict[str, List[str]]:
        """Collect format parts grouped by format"""
        format_parts_per_format = {}
        
        for format_name, fmt in formats_data.items():
            data_items = fmt.get("data", [])
            if not isinstance(data_items, list):
                continue
            
            format_parts = set()
            for item in data_items:
                part = item.get("formatPart")
                if not part:
                    continue
                
                part = part.strip()
                
                # Skip invalid/empty parts
                if part == "FTL." or re.match(r'^-+$', part):
                    continue
                
                format_parts.add(part)
            
            format_parts_per_format[format_name] = sorted(format_parts)
        
        return format_parts_per_format


def parse_format_data_from_file(filepath: str) -> Dict[str, Any]:
    """
    Legacy function for backward compatibility
    Parse format data from HTML file
    """
    parser = FormatDataParser(filepath)
    return parser.parse()


class FormatDataManager:
    """High-level manager for format data operations"""
    
    def __init__(self, cache_file_path: str):
        self.cache_file_path = Path(cache_file_path)
        self._parser: Optional[FormatDataParser] = None
    
    def _get_parser(self) -> FormatDataParser:
        """Get or create parser instance"""
        if self._parser is None:
            self._parser = FormatDataParser(str(self.cache_file_path))
        return self._parser
    
    def file_exists(self) -> bool:
        """Check if the cache file exists"""
        return self.cache_file_path.exists()
    
    def get_format_data(self) -> Dict[str, Any]:
        """Get complete format data"""
        if not self.file_exists():
            return {}
        
        try:
            return self._get_parser().parse()
        except Exception as e:
            logger.error(f"Error getting format data: {e}")
            return {}
    
    def get_format_parts(self) -> Dict[str, Any]:
        """Get format parts with metadata"""
        if not self.file_exists():
            return {
                "formatParts": [],
                "count": 0,
                "message": "No HTML file uploaded"
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
    
    def get_formats(self) -> Dict[str, Any]:
        """Get formats with metadata"""
        if not self.file_exists():
            return {
                "formats": {},
                "formatNames": [],
                "count": 0,
                "message": "No HTML file uploaded"
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
    
    def get_format_parts_per_format(self) -> Dict[str, Any]:
        """Get format parts per format with metadata"""
        if not self.file_exists():
            return {
                "formatPartsPerFormat": {},
                "formatCount": 0,
                "message": "No HTML file uploaded"
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
