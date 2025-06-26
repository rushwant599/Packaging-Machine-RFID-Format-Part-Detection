# OPC UA Client Integration

Diese Dokumentation beschreibt die OPC UA Client Funktionalität, die in das RFID Parts Backend integriert wurde.

## Überblick

Das Backend enthält jetzt einen vollständig konfigurierbaren OPC UA Client, der sich mit einem OPC UA Server verbinden und Werte von einem konfigurierten Node abonnieren kann.

## Konfiguration

Die OPC UA Funktionalität wird über Umgebungsvariablen konfiguriert:

### Umgebungsvariablen

| Variable | Beschreibung | Standard | Beispiel |
|----------|--------------|----------|----------|
| `OPC_UA_ENABLED` | Aktiviert/deaktiviert OPC UA Client | `false` | `true` |
| `OPC_UA_SERVER_URL` | URL des OPC UA Servers | `opc.tcp://localhost:4840` | `opc.tcp://192.168.1.100:4840` |
| `OPC_UA_NODE_ID` | Node ID die überwacht werden soll | `ns=2;i=1` | `ns=3;s=Temperature` |

### Konfigurationsdateien

#### Lokale Entwicklung (`.env.local`)
```bash
# OPC UA Configuration
OPC_UA_SERVER_URL=opc.tcp://localhost:4840
OPC_UA_NODE_ID=ns=2;i=1
OPC_UA_ENABLED=true
```

#### Docker Deployment (`.env.docker`)
```bash
# OPC UA Configuration
OPC_UA_SERVER_URL=opc.tcp://host.docker.internal:4840
OPC_UA_NODE_ID=ns=2;i=1
OPC_UA_ENABLED=true
```

## Features

### Automatische Verbindung
- Der Client versucht automatisch, sich beim Start zu verbinden
- Bei Verbindungsfehlern werden automatische Wiederverbindungsversuche unternommen
- Background-Task überwacht kontinuierlich die Verbindung

### Datensammlung
- Automatisches Lesen des konfigurierten Node-Wertes alle 5 Sekunden
- Speicherung des aktuellen Wertes mit Zeitstempel und Datentyp
- Fehlerbehandlung bei Kommunikationsproblemen

### RESTful API
Vollständige REST API für OPC UA Funktionalität (siehe API Referenz unten)

## API Referenz

### Status Endpoints

#### `GET /api/opc-ua/status`
Gibt den aktuellen Status des OPC UA Clients zurück.

**Response:**
```json
{
  "enabled": true,
  "available": true,
  "connection_status": "connected",
  "server_url": "opc.tcp://localhost:4840",
  "node_id": "ns=2;i=1",
  "last_updated": "2025-06-26T14:30:00",
  "current_value": {
    "value": 42.5,
    "data_type": "Float",
    "timestamp": "2025-06-26T14:30:00"
  }
}
```

#### `GET /api/health`
Health Check mit OPC UA Status.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "cache_file_exists": true,
  "opc_ua": {
    "enabled": true,
    "available": true,
    "connection_status": "connected",
    "has_value": true,
    "last_updated": "2025-06-26T14:30:00"
  }
}
```

### Data Endpoints

#### `GET /api/opc-ua/value`
Gibt den aktuellen Wert des überwachten Node zurück.

**Response (Erfolg):**
```json
{
  "success": true,
  "data": {
    "value": 42.5,
    "data_type": "Float",
    "timestamp": "2025-06-26T14:30:00"
  },
  "last_updated": "2025-06-26T14:30:00"
}
```

**Response (Fehler):**
```json
{
  "detail": "OPC UA not connected: error: Connection refused"
}
```

#### `POST /api/opc-ua/refresh`
Erzwingt eine sofortige Aktualisierung des Node-Wertes.

**Response:**
```json
{
  "success": true,
  "message": "Value refreshed successfully",
  "data": {
    "value": 43.1,
    "data_type": "Float",
    "timestamp": "2025-06-26T14:31:00"
  }
}
```

### Control Endpoints

#### `POST /api/opc-ua/reconnect`
Erzwingt eine Neuverbindung zum OPC UA Server.

**Response:**
```json
{
  "success": true,
  "message": "Successfully reconnected to OPC UA server",
  "status": "connected"
}
```

## Test Interface

Eine Web-Oberfläche zum Testen der OPC UA Funktionalität ist verfügbar unter:
`http://localhost:3000/opc-ua-test.html`

### Features der Test-Oberfläche:
- Echtzeit-Status-Anzeige
- Konfigurationsübersicht
- Manuelle Wert-Aktualisierung
- Neuverbindung erzwingen
- Live-Logs
- Auto-Refresh alle 10 Sekunden

## Fehlerbehandlung

### Verbindungsstatus
| Status | Beschreibung |
|--------|--------------|
| `connected` | Erfolgreich verbunden |
| `disconnected` | Nicht verbunden |
| `library_unavailable` | OPC UA Bibliothek nicht installiert |
| `error: <message>` | Verbindungsfehler mit Details |

### Häufige Fehler

1. **Connection refused**
   - OPC UA Server läuft nicht
   - Falsche Server URL
   - Firewall blockiert Verbindung

2. **Node not found**
   - Falsche Node ID
   - Node existiert nicht auf dem Server
   - Keine Berechtigung für den Node

3. **Library unavailable**
   - `asyncua` nicht installiert
   - Python-Umgebung nicht aktiviert

## Installation

### Python Dependencies
```bash
pip install asyncua==1.1.5
```

### Docker
Die OPC UA Funktionalität ist bereits im Docker Image enthalten.

## Architektur

### Background Task
Ein AsyncIO Background Task läuft kontinuierlich und:
- Überwacht die Verbindung zum OPC UA Server
- Liest alle 5 Sekunden den Node-Wert
- Behandelt Verbindungsfehler automatisch
- Versucht Wiederverbindungen bei Fehlern

### Thread Safety
- Alle OPC UA Operationen sind async/await basiert
- Global state wird thread-safe verwaltet
- Keine Blocking Operations im Main Thread

### Memory Management
- Automatische Cleanup bei Server Shutdown
- Verbindungen werden ordnungsgemäß geschlossen
- Keine Memory Leaks bei Long-Running Betrieb

## Deployment

### Lokale Entwicklung
1. OPC UA Server starten (z.B. mit Simulation)
2. Environment-Variablen in `.env.local` setzen
3. Backend starten: `python backend/main.py`

### Docker Deployment
1. OPC UA Server auf Host-System verfügbar machen
2. Environment-Variablen in `.env.docker` setzen
3. Docker Container starten: `docker-compose up`

### Produktions-Deployment
- Sichere OPC UA Verbindung mit Zertifikaten
- Monitoring der OPC UA Verbindung
- Backup-Strategien bei Server-Ausfällen
- Load Balancing bei mehreren Clients

## Monitoring

### Logs
Alle OPC UA Aktivitäten werden geloggt:
```
INFO:main:OPC UA - Enabled: True, Server: opc.tcp://localhost:4840, Node: ns=2;i=1
INFO:main:Starting OPC UA monitoring task
INFO:main:Attempting to connect to OPC UA server...
INFO:main:Successfully connected to OPC UA server and node ns=2;i=1
```

### Metriken
- Verbindungsstatus über `/api/health`
- Letzte Aktualisierung über API
- Fehlerrate durch Logs verfolgbar

## Sicherheit

### Best Practices
- Verwenden Sie sichere OPC UA Verbindungen (opc.tcp mit Zertifikaten)
- Beschränken Sie Netzwerkzugriff auf OPC UA Ports
- Überwachen Sie Verbindungsversuche
- Implementieren Sie Rate Limiting für API Calls

### Authentifizierung
Die aktuelle Implementierung unterstützt anonyme Verbindungen. Für Produktionsumgebungen sollten Sie:
- Benutzername/Passwort Authentifizierung implementieren
- Zertifikat-basierte Authentifizierung verwenden
- OPC UA Security Policies konfigurieren

## Erweiterte Konfiguration

### Mehrere Nodes
Um mehrere Nodes zu überwachen, können Sie die Implementierung erweitern:
```python
# Beispiel für mehrere Nodes
OPC_UA_NODES = "ns=2;i=1,ns=2;i=2,ns=3;s=Temperature"
```

### Custom Data Types
Die Implementierung unterstützt alle OPC UA Datentypen automatisch.

### Subscriptions
Für Echtzeit-Updates können Sie OPC UA Subscriptions implementieren statt Polling.

## Troubleshooting

### Debug Mode
Aktivieren Sie Debug-Logging:
```bash
DEBUG=true
```

### Netzwerk-Diagnose
```bash
# Test OPC UA Server Erreichbarkeit
telnet <server-ip> 4840

# OPC UA Client Test (mit opcua-client tool)
opcua-client --url opc.tcp://localhost:4840
```

### API Test
```bash
# Status prüfen
curl http://localhost:8001/api/opc-ua/status

# Wert abrufen
curl http://localhost:8001/api/opc-ua/value

# Neuverbindung
curl -X POST http://localhost:8001/api/opc-ua/reconnect
```
