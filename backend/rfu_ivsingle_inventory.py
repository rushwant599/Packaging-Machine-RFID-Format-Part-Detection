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
import asyncio
import logging
from typing import List, Tuple, Dict, Any, Generator, AsyncGenerator, Optional
from dataclasses import dataclass, field

REQ_BASE = "sMN IVSingleInv"
ANS_PREFIX = "sAN IVSingleInv"

logger = logging.getLogger(__name__)


# --- Fehlerklassen -----------------------------------------------------------
class RFUInventoryError(Exception):
    """Allgemeiner Fehler beim Inventur-Polling."""


class RFUConnectionError(RFUInventoryError):
    """Verbindungsaufbau oder -abbruch fehlgeschlagen."""


class RFUProtocolError(RFUInventoryError):
    """Antwortformat oder Protokollverletzung."""


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


# --- Async Varianten ---------------------------------------------------------
async def send_cmd_async(writer: asyncio.StreamWriter, cmd: str, framed: bool):
    if framed:
        writer.write(b"\x02" + cmd.encode('ascii') + b"\x03")
    else:
        if not cmd.endswith("\r\n"):
            cmd = cmd + "\r\n"
        writer.write(cmd.encode('ascii'))
    await writer.drain()


async def recv_answer_async(reader: asyncio.StreamReader, timeout: float, framed: bool) -> str | None:
    data = bytearray()

    async def _read_framed():
        started = False
        while True:
            b = await reader.read(1)
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

    async def _read_line():
        while True:
            b = await reader.read(1)
            if not b:
                break
            data.extend(b)
            if b == b"\n":
                break

    try:
        if framed:
            await asyncio.wait_for(_read_framed(), timeout=timeout)
        else:
            await asyncio.wait_for(_read_line(), timeout=timeout)
    except asyncio.TimeoutError:
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


@dataclass
class RFUInventoryClient:
    """Wiederverwendbare API für IVSingleInv.

    Nutzung:
        client = RFUInventoryClient(ip="10.11.36.216", ant="F")
        with client:  # öffnet Verbindung
            epcs = client.poll_once()            # nur EPCs
            tags = client.poll_once(full=True)   # detaillierte Tag-Objekte

        # Kontinuierlich:
        for epcs in client.poll_loop(interval=1.0, limit=0):
            print(epcs)

    Hauptmethoden:
        poll_once(full=False) -> List[str] | List[Dict]
        poll_loop(interval, limit, full) -> Generator
    """

    ip: str
    port: int = 2111
    ant: str = '1'
    timeout: float = 0.8
    connect_timeout: float = 2.0
    framed: bool = True
    _sock: Optional[socket.socket] = field(default=None, init=False, repr=False)

    # --- Verbindungs-Handling -------------------------------------------------
    def connect(self):
        if self._sock is not None:
            return
        addr = (self.ip, self.port)
        try:
            self._sock = socket.create_connection(addr, timeout=self.connect_timeout)
            logger.info("Verbunden zu %s:%s", *addr)
        except OSError as e:
            logger.error("Verbindung fehlgeschlagen: %s", e)
            raise RFUConnectionError(str(e)) from e

    def close(self):
        if self._sock is not None:
            try:
                self._sock.close()
                logger.info("Verbindung geschlossen")
            finally:
                self._sock = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()
        return False

    # --- Poll Logik -----------------------------------------------------------
    def _ensure(self):
        if self._sock is None:
            self.connect()

    def poll_once(self, full: bool = False):
        """Führt genau EIN IVSingleInv aus.

        full=False: Rückgabe List[str] (EPCs)
        full=True:  Rückgabe List[Dict[str,Any]] (Tag-Objekte)
        """
        self._ensure()
        assert self._sock is not None
        req = f"{REQ_BASE} {self.ant}"
        try:
            send_cmd(self._sock, req, framed=self.framed)
        except OSError as e:
            logger.error("Senden fehlgeschlagen: %s", e)
            raise RFUConnectionError(str(e)) from e
        line = recv_answer(self._sock, timeout=self.timeout, framed=self.framed)
        if line is None:
            logger.debug("Keine Antwort / Timeout")
            return []
        logger.debug("RAW Antwort: %s", line)
        _, tag_list = parse_line(line)
        if full:
            # Nur relevante Felder zurückgeben (nicht status/rssi_raw/power_raw zwingend nötig)
            return [
                {
                    'epc': t['epc'],
                    'pc': t['pc'],
                    'antenna': t['antenna'],
                    'rssi_dbm': t['rssi_dbm'],
                    'power_dbm': t['power_dbm'],
                    'raw_epc_pc': t['raw_epc_pc'],
                    'rssi_raw': t['rssi_raw'],
                    'power_raw': t['power_raw']
                }
                for t in tag_list
            ]
        return [t['epc'] for t in tag_list]

    def poll_once_safe(self, full: bool = False) -> Tuple[List[Any], Optional[Exception]]:
        """Wrapper, der Fehler abfängt und als Rückgabe liefert."""
        try:
            return self.poll_once(full=full), None
        except Exception as e:  # noqa: BLE001
            logger.exception("poll_once Fehler")
            return [], e

    def poll_loop(self, interval: float = 1.0, limit: int = 0, full: bool = False) -> Generator[List[Any], None, None]:
        """Endlosschleife (oder begrenzte Anzahl) als Generator.

        yield pro Iteration: Liste wie bei poll_once(full=...)
        limit=0 => unendlich
        """
        poll = 0
        try:
            while limit == 0 or poll < limit:
                poll += 1
                try:
                    yield self.poll_once(full=full)
                except (socket.timeout, OSError):
                    # Verbindung resetten und leere Liste liefern
                    self.close()
                    yield []
                    # leichter Backoff
                    time.sleep(min(interval, 0.5))
                    continue
                time.sleep(interval)
        except GeneratorExit:
            return


def run(args):
    """CLI-Laufzeit (beibehaltet Rückwärtskompatibilität)."""
    client = RFUInventoryClient(
        ip=args.ip,
        port=args.port,
        ant=args.ant,
        timeout=args.timeout,
        connect_timeout=args.connect_timeout,
        framed=True,
    )
    import json
    try:
        with client:
            for result in client.poll_loop(interval=args.interval, limit=args.limit, full=args.full):
                print(json.dumps(result, ensure_ascii=False))
    except RFUInventoryError as e:
        logger.error("RFU Fehler: %s", e)
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info("Abbruch durch Benutzer")


# --- Async Variante ----------------------------------------------------------
@dataclass
class AsyncRFUInventoryClient:
    ip: str
    port: int = 2111
    ant: str = '1'
    timeout: float = 0.8
    connect_timeout: float = 2.0
    framed: bool = True
    _reader: Optional[asyncio.StreamReader] = field(default=None, init=False, repr=False)
    _writer: Optional[asyncio.StreamWriter] = field(default=None, init=False, repr=False)

    async def connect(self):
        if self._reader is not None:
            return
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.ip, self.port), timeout=self.connect_timeout
            )
            logger.info("(async) Verbunden zu %s:%s", self.ip, self.port)
        except Exception as e:  # noqa: BLE001
            logger.error("(async) Verbindung fehlgeschlagen: %s", e)
            raise RFUConnectionError(str(e)) from e

    async def close(self):
        if self._writer is not None:
            try:
                self._writer.close()
                await self._writer.wait_closed()
                logger.info("(async) Verbindung geschlossen")
            finally:
                self._reader = None
                self._writer = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self.close()
        return False

    async def poll_once(self, full: bool = False):
        if self._reader is None or self._writer is None:
            await self.connect()
        assert self._reader and self._writer
        req = f"{REQ_BASE} {self.ant}"
        try:
            await send_cmd_async(self._writer, req, framed=self.framed)
        except Exception as e:  # noqa: BLE001
            logger.error("(async) Senden fehlgeschlagen: %s", e)
            raise RFUConnectionError(str(e)) from e
        try:
            line = await recv_answer_async(self._reader, timeout=self.timeout, framed=self.framed)
        except Exception as e:  # noqa: BLE001
            logger.error("(async) Empfang fehlgeschlagen: %s", e)
            raise RFUConnectionError(str(e)) from e
        if line is None:
            logger.debug("(async) Keine Antwort / Timeout")
            return []
        logger.debug("(async) RAW Antwort: %s", line)
        _, tag_list = parse_line(line)
        if full:
            return [
                {
                    'epc': t['epc'],
                    'pc': t['pc'],
                    'antenna': t['antenna'],
                    'rssi_dbm': t['rssi_dbm'],
                    'power_dbm': t['power_dbm'],
                    'raw_epc_pc': t['raw_epc_pc'],
                    'rssi_raw': t['rssi_raw'],
                    'power_raw': t['power_raw']
                }
                for t in tag_list
            ]
        return [t['epc'] for t in tag_list]

    async def poll_loop(self, interval: float = 1.0, limit: int = 0, full: bool = False) -> AsyncGenerator[List[Any], None]:
        poll = 0
        try:
            while limit == 0 or poll < limit:
                poll += 1
                try:
                    yield await self.poll_once(full=full)
                except RFUInventoryError:
                    # Fehler weiterreichen nach Logging
                    raise
                except Exception as e:  # noqa: BLE001
                    logger.exception("(async) Unbekannter Fehler im Poll")
                    raise RFUInventoryError(str(e)) from e
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            logger.info("(async) Poll Loop abgebrochen")
            raise

    async def poll_once_safe(self, full: bool = False) -> Tuple[List[Any], Optional[Exception]]:
        try:
            return await self.poll_once(full=full), None
        except Exception as e:  # noqa: BLE001
            logger.exception("(async) poll_once Fehler")
            return [], e


def build_arg_parser():
    p = argparse.ArgumentParser(description="RFU6xx IVSingleInv Poller")
    p.add_argument('--ip', required=True)
    p.add_argument('--port', type=int, default=2111)
    p.add_argument('--ant', default='1', help='Antennenmaske (z.B. 1,2,3,F)')
    p.add_argument('--interval', type=float, default=1.0, help='Sekunden zwischen Polls (Default 1.0)')
    p.add_argument('--timeout', type=float, default=0.8, help='Antwort-Timeout pro Poll (Default 0.8)')
    p.add_argument('--connect-timeout', type=float, default=2.0)
    p.add_argument('--limit', type=int, default=0, help='Anzahl Polls (0=unbegrenzt)')
    p.add_argument('--full', action='store_true', help='Gibt vollständige Tag-Objekte (inkl. RSSI/Power) statt nur EPCs aus')
    p.add_argument('--log-level', default='INFO', help='Logging Level (DEBUG, INFO, WARNING, ERROR)')
    return p


def setup_logging(level: str):
    lvl = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        level=lvl,
        format='%(asctime)s %(levelname)s %(name)s: %(message)s',
        datefmt='%H:%M:%S'
    )


if __name__ == '__main__':
    parser = build_arg_parser()
    args = parser.parse_args()
    setup_logging(args.log_level)
    run(args)
