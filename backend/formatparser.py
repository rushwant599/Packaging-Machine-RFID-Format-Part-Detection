import os
import re
import json
from bs4 import BeautifulSoup


# To use this function, ensure you have the BeautifulSoup library installed:
# pip install beautifulsoup4
# This function parses the HTML file to extract format data and format parts.
# Usage:    data = parse_format_data_from_file("pfad/zur/datei.html")
#           print(data["formatParts"])  # Ausgabe der einzelnen formatParts 
def parse_format_data_from_file(filepath):
    if not os.path.isfile(filepath):
        raise FileNotFoundError(f"Die Datei '{filepath}' wurde nicht gefunden.")

    with open(filepath, 'r', encoding='utf-8') as file:
        html_content = file.read()

    soup = BeautifulSoup(html_content, 'html.parser')
    format_data = {}

    # Extrahiere Scripts
    script_element = soup.find(id="FormatData")
    if not script_element:
        return format_data

    script_content = script_element.get_text(strip=True)

    # Sanitize
    script_content = re.sub(r'[\u0000-\u001F\u007F-\u009F]', '', script_content)

    match = re.search(r'var\s+formats\s*=\s*({[\s\S]*?});', script_content)
    if not match:
        return format_data

    formats_json_str = match.group(1)

    try:
        formats_data = json.loads(formats_json_str)
        format_data['formats'] = formats_data

        # formatParts sammeln
        format_parts_set = set()

        for fmt in formats_data.values():
            data_items = fmt.get("data", [])
            if isinstance(data_items, list):
                for item in data_items:
                    part = item.get("formatPart")
                    if part:
                        part = part.strip()
                        # Filter: Platzhalter ignorieren
                        if part == "FTL." or re.match(r'^-+$', part):
                            continue
                        format_parts_set.add(part)

        format_data['formatParts'] = sorted(format_parts_set)

    except json.JSONDecodeError as e:
        raise ValueError("Fehler beim Parsen von JSON nach Sanitize: " + str(e))

    return format_data
