"""RFU6xx Inventory über den CoLa-A Method-Befehl IVSingleInv (laut Doku Abschnitt 3.10).

Vereinfachte Variante:
 - Immer STX/ETX gerahmt (framed)
 - Poll exakt 1x pro Sekunde (konfigurierbar via --interval, Standard 1.0)
 - Ausgabe pro Poll NUR ein Array der aktuell im Poll erfassten EPCs (ohne PC Wort)
     Beispiel: ["3000111122223333444455556666", "31A1AAAABBBBAAAABBBBAAAA0001"]
 - Keine Status-/RSSI-/Power-Ausgabe mehr, nur Roh-EPC Werte pro Inventur.

Format laut Beispiel:
    Request: sMN IVSingleInv <AntMask>
        AntMask (hex/octal/char) z.B. 1,2,3,...,F (F = alle Antennen)
    Response: sAN IVSingleInv <Status> <TagCount> [TagBlocks...]

TagBlock (pro Tag):
    <LenUII> <UII/EPC(hex inkl. PC)> <AntennaID> <RSSI1> <RSSI2> <RSSI3> <RSSI4> <Pwr1> <Pwr2> <Pwr3> <Pwr4>

Interpretation:
    RSSI dBm Beispiel: 0xFFFF - FE4C = 0x1B3 = 435 -> -43.5 dBm  => dBm = -( (0xFFFF - raw) / 10 )
    Power: Hexwert / 10 (0x96=150 -> 15.0 dBm)

Beispiel Antwort (1 Tag):
    sAN IVSingleInv 1 1 1C 3000..6666 1 FE4C 0 0 0 96 0 0 0

Aufruf:
    python rfu_ivsingle_inventory.py --ip 10.11.36.216 --ant F --raw

    python rfu_ivsingle_inventory.py --ip 10.11.36.216 --ant F   <-----

Optionen:
    --ant F              Antennenmaske (Standard 1)
    --interval 0.3       Poll-Intervall
    --timeout 0.4        Antwort-Timeout
    --framed             STX/ETX Rahmen verwenden
    --show-duplicates    Duplikate auch ausgeben
    --raw                Rohzeile anzeigen
    --json               Strukturiertes JSON für jedes Tag
    --limit N            Anzahl Polls (0 = endlos)

Hinweis: Falls keine Antwort kommt, Maske anpassen (z.B. 1 oder F) oder Timeout erhöhen.
"""
from __future__ import annotations
import socket
import time
import argparse
import sys
from typing import List, Tuple, Dict, Any

REQ_BASE = "sMN IVSingleInv"
ANS_PREFIX = "sAN IVSingleInv"


def send_cmd(sock: socket.socket, cmd: str, framed: bool):
    if framed:
        sock.sendall(b"\x02" + cmd.encode('ascii') + b"\x03")
    else:
        if not cmd.endswith("\r\n"):
            cmd = cmd + "\r\n"
        sock.sendall(cmd.encode('ascii'))


def recv_answer(sock: socket.socket, timeout: float, framed: bool) -> str | None:
    sock.settimeout(timeout)
    data = bytearray()
    try:
        if framed:
            started = False
            while True:
                b = sock.recv(1)
                if not b:
                    break
                if b == b"\x02" and not started:
                    started = True
                    continue
                if not started:
                    continue
                if b == b"\x03":
                    break
                data.extend(b)
        else:
            # lese bis Newline oder Timeout
            while True:
                b = sock.recv(1)
                if not b:
                    break
                data.extend(b)
                if b == b"\n":
                    break
    except socket.timeout:
        if not data:
            return None
    if not data:
        return None
    line = data.decode('ascii', errors='ignore').strip('\r\n')
    if not line:
        return None
    return line


def _is_hex(s: str) -> bool:
    return all(c in '0123456789ABCDEFabcdef' for c in s)


def parse_line(line: str) -> Tuple[int, List[Dict[str, Any]]]:
    """Parse eine Antwortzeile exakt gemäß Dokument.

    Rückgabe: (tag_count, tag_list)
    tag_list: Liste Dicts mit EPC (ohne PC), PC, raw_epc (inkl. PC), antenna, rssi_dbm, power_dbm.
    """
    if not line.startswith(ANS_PREFIX):
        return 0, []
    tokens = line.split()
    if len(tokens) < 4:
        return 0, []

    status_tok = tokens[2]
    count_tok = tokens[3]
    # Status 1 = success; ignorieren falls anders
    try:
        tag_count = int(count_tok, 16) if _is_hex(count_tok) and not count_tok.isdigit() else int(count_tok)
    except ValueError:
        tag_count = 0

    idx = 4
    tags: List[Dict[str, Any]] = []
    for _ in range(tag_count):
        # Sicherstellen, dass genug Tokens übrig sind
        if idx + 10 > len(tokens):
            break
        len_uii = tokens[idx]; idx += 1
        if not _is_hex(len_uii):
            break
        # EPC inkl PC Wort
        raw_epc = tokens[idx]; idx += 1
        # Minimale Plausibilität: Länge *?= hex chars. Manual zeigt '1C' -> 28 hex chars -> hier 3000.... (28?)
        antenna_id = tokens[idx]; idx += 1
        # 4 RSSI
        rssi_tokens = tokens[idx:idx+4]; idx += 4
        # 4 Power
        power_tokens = tokens[idx:idx+4]; idx += 4

        # RSSI Umrechnung nur für das erste Nicht-Null Token (oder das zum Antenna ID passende?)
        def rssi_to_dbm(raw_hex: str) -> float | None:
            if not _is_hex(raw_hex):
                return None
            try:
                val = int(raw_hex, 16)
            except ValueError:
                return None
            if val == 0:
                return None
            dbm = -((0xFFFF - val) / 10.0)
            return round(dbm, 1)

        rssi_dbm = None
        for rt in rssi_tokens:
            if rt not in ('0', '0000'):  # erstes valides nehmen
                rssi_dbm = rssi_to_dbm(rt)
                if rssi_dbm is not None:
                    break

        def power_to_dbm(raw_hex: str) -> float | None:
            if not _is_hex(raw_hex):
                return None
            try:
                val = int(raw_hex, 16)
            except ValueError:
                return None
            if val == 0:
                return None
            return round(val / 10.0, 1)

        power_dbm = None
        for pt in power_tokens:
            if pt not in ('0', '0000'):  # erstes valides
                power_dbm = power_to_dbm(pt)
                if power_dbm is not None:
                    break

        # EPC ohne PC: PC = erste 4 hex Zeichen
        cleaned_epc = raw_epc[4:] if len(raw_epc) > 4 else raw_epc
        tags.append({
            'raw_len_field': len_uii,
            'raw_epc_pc': raw_epc,
            'pc': raw_epc[:4],
            'epc': cleaned_epc,
            'antenna': antenna_id,
            'rssi_dbm': rssi_dbm,
            'power_dbm': power_dbm,
            'rssi_raw': rssi_tokens,
            'power_raw': power_tokens,
            'status': status_tok
        })

    return tag_count, tags


def run(args):
    addr = (args.ip, args.port)
    print(f"Verbinde zu {addr} ...")
    try:
        with socket.create_connection(addr, timeout=args.connect_timeout) as sock:
            print("Verbunden.")
            poll = 0
            try:
                while args.limit == 0 or poll < args.limit:
                    poll += 1
                    req = f"{REQ_BASE} {args.ant}"
                    send_cmd(sock, req, framed=True)  # immer gerahmt
                    line = recv_answer(sock, timeout=args.timeout, framed=True)
                    if line is None:
                        print("[]")  # keine Tags
                        time.sleep(args.interval)
                        continue
                    cnt, tag_list = parse_line(line)
                    # EPC Liste extrahieren
                    epcs = [t['epc'] for t in tag_list] if tag_list else []
                    import json
                    print(json.dumps(epcs, ensure_ascii=False))
                    time.sleep(args.interval)
            except KeyboardInterrupt:
                print("Abbruch (Ctrl+C)")
    except (socket.timeout, OSError) as e:
        print(f"Verbindungsfehler: {e}")
        sys.exit(1)


def build_arg_parser():
    p = argparse.ArgumentParser(description="RFU6xx IVSingleInv Poller")
    p.add_argument('--ip', required=True)
    p.add_argument('--port', type=int, default=2111)
    p.add_argument('--ant', default='1', help='Antennenmaske (z.B. 1,2,3,F)')
    p.add_argument('--interval', type=float, default=1.0, help='Sekunden zwischen Polls (Default 1.0)')
    p.add_argument('--timeout', type=float, default=0.8, help='Antwort-Timeout pro Poll (Default 0.8)')
    p.add_argument('--connect-timeout', type=float, default=2.0)
    p.add_argument('--limit', type=int, default=0, help='Anzahl Polls (0=unbegrenzt)')
    return p


if __name__ == '__main__':
    parser = build_arg_parser()
    args = parser.parse_args()
    run(args)
