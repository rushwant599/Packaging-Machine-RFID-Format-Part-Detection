import os
import json
from typing import Dict, Any

# Prefer a fixed path inside the container by default. Can be overridden via CONFIG_PATH env.
CONFIG_PATH = os.environ.get("CONFIG_PATH", "/app/data/config.json")

#Default configuration
DEFAULT_CONFIG = {
    #PLC OPC UA
    "OPC_UA_SERVER_URL": "opc.tcp://IP-Address-PLC:4840",
    "OPC_UA_NODE_ID": "ns=2;s=.G_HMI.stCM.sFormatAktiv",
    "OPC_UA_ENABLED": False,
    # Event Listener 
    "OPC_UA_EVENT_ENABLED": False,
    "OPC_UA_EVENT_SERVER_URL": "opc.tcp://IP-Address-RFID:4840",
    "OPC_UA_EVENT_TYPE": "ns=4;i=6050",
    "OPC_UA_EVENT_INTERVAL_MS": 500,
    "OPC_UA_EVENT_MAX_EVENTS": 500,
    # Direct RFID Inventory via TCP/IP (CoLa)
    "RFID_INVENTORY_ENABLED": False,
    "RFID_READER_IP": "",
    "RFID_READER_PORT": 2111,
    "RFID_READER_ANT": "F",
    "RFID_CURRENT_RETENTION_SEC": 10,
    "RFID_INVENTORY_INTERVAL_SEC": 1
}

def load_config() -> Dict[str, Any]:
    """
    Build configuration with precedence: ENV > FILE > DEFAULTS.
    If the config file is missing, empty, or invalid JSON, it will be created
    at CONFIG_PATH with the merged values (env overriding defaults).
    """
    # Helper: cast env var to the type of its default value (bool handled separately)
    def _cast_env_value(key: str, value: str) -> Any:
        if key.endswith("ENABLED"):
            return str(value).strip().lower() == "true"
        default_val = DEFAULT_CONFIG.get(key)
        if default_val is None:
            return value  # unknown key, keep as string
        try:
            if isinstance(default_val, int) and not isinstance(default_val, bool):
                return int(value)
            # Add more casts if needed (float, etc.)
        except (TypeError, ValueError):
            return value
        return value

    # 1) Start from defaults
    config: Dict[str, Any] = dict(DEFAULT_CONFIG)

    # 2) Try to read from file
    file_config: Dict[str, Any] = {}
    file_valid = False
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                content = f.read()
                if content.strip():
                    file_config = json.loads(content)
                    if isinstance(file_config, dict):
                        file_valid = True
        except (OSError, json.JSONDecodeError):
            file_valid = False

    if file_valid:
        config.update(file_config)

    # 3) Apply environment variables (override file and defaults)
    env_map = {
        "OPC_UA_SERVER_URL": os.environ.get("OPC_UA_SERVER_URL"),
        "OPC_UA_NODE_ID": os.environ.get("OPC_UA_NODE_ID"),
        "OPC_UA_ENABLED": os.environ.get("OPC_UA_ENABLED"),
        "OPC_UA_EVENT_ENABLED": os.environ.get("OPC_UA_EVENT_ENABLED"),
        "OPC_UA_EVENT_SERVER_URL": os.environ.get("OPC_UA_EVENT_SERVER_URL"),
        "OPC_UA_EVENT_TYPE": os.environ.get("OPC_UA_EVENT_TYPE"),
        "OPC_UA_EVENT_INTERVAL_MS": os.environ.get("OPC_UA_EVENT_INTERVAL_MS"),
        "OPC_UA_EVENT_MAX_EVENTS": os.environ.get("OPC_UA_EVENT_MAX_EVENTS"),
        "RFID_INVENTORY_ENABLED": os.environ.get("RFID_INVENTORY_ENABLED"),
        "RFID_READER_IP": os.environ.get("RFID_READER_IP"),
        "RFID_READER_PORT": os.environ.get("RFID_READER_PORT"),
        "RFID_READER_ANT": os.environ.get("RFID_READER_ANT"),
        "RFID_CURRENT_RETENTION_SEC": os.environ.get("RFID_CURRENT_RETENTION_SEC"),
        "RFID_INVENTORY_INTERVAL_SEC": os.environ.get("RFID_INVENTORY_INTERVAL_SEC"),
    }
    for key, value in env_map.items():
        if value is not None:
            config[key] = _cast_env_value(key, value)

    # 4) Ensure the config file exists and is valid; if not, create/update it
    if not file_valid:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    return config

def save_config(config: Dict[str, Any]):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
