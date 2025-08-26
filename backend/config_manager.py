import os
import json
from typing import Dict, Any

CONFIG_PATH = os.environ.get("CONFIG_PATH", "data/config.json")

DEFAULT_CONFIG = {
    "OPC_UA_SERVER_URL": "opc.tcp://192.168.18.8:4840",
    "OPC_UA_NODE_ID": "ns=2;s=.G_HMI.stCM.sFormatAktiv",
    "OPC_UA_ENABLED": True,
    "RFID_OPC_ENABLED": False,
    "RFID_OPC_SERVER_URL": "opc.tcp://10.11.36.216:4840",
    "RFID_OPC_NODE_ID": "ns=4;i=6023",
    # New: Direct RFID Inventory (socket) config
    "RFID_INVENTORY_ENABLED": False,
    "RFID_READER_IP": "",
    "RFID_READER_PORT": 2111,
    "RFID_READER_ANT": "F",
    "RFID_CURRENT_RETENTION_SEC": 10,
    "RFID_INVENTORY_INTERVAL_SEC": 1
}

def load_config() -> Dict[str, Any]:
    # 1. Starte mit ENV, falls gesetzt
    config = {}
    env_map = {
        "OPC_UA_SERVER_URL": os.environ.get("OPC_UA_SERVER_URL"),
        "OPC_UA_NODE_ID": os.environ.get("OPC_UA_NODE_ID"),
        "OPC_UA_ENABLED": os.environ.get("OPC_UA_ENABLED"),
        "RFID_OPC_ENABLED": os.environ.get("RFID_OPC_ENABLED"),
        "RFID_OPC_SERVER_URL": os.environ.get("RFID_OPC_SERVER_URL"),
        "RFID_OPC_NODE_ID": os.environ.get("RFID_OPC_NODE_ID"),
        # Direct RFID inventory env overrides
        "RFID_INVENTORY_ENABLED": os.environ.get("RFID_INVENTORY_ENABLED"),
        "RFID_READER_IP": os.environ.get("RFID_READER_IP"),
        "RFID_READER_PORT": os.environ.get("RFID_READER_PORT"),
        "RFID_READER_ANT": os.environ.get("RFID_READER_ANT"),
        "RFID_CURRENT_RETENTION_SEC": os.environ.get("RFID_CURRENT_RETENTION_SEC"),
    "RFID_INVENTORY_INTERVAL_SEC": os.environ.get("RFID_INVENTORY_INTERVAL_SEC"),
    }
    for key, value in env_map.items():
        if value is not None:
            # Für boolsche Werte
            if key.endswith("ENABLED"):
                config[key] = value.lower() == "true"
            else:
                config[key] = value
    # 2. Überschreibe mit gespeicherter Config, falls vorhanden
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config.update(json.load(f))
    # 3. Fülle fehlende Werte mit Defaults
    for key, value in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = value
    return config

def save_config(config: Dict[str, Any]):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
