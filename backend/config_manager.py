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

def _cast_env_value(key: str, value: str) -> Any:
    """Cast env string to the type expected by the default config for that key."""
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

def _read_file_config(path: str) -> tuple[Dict[str, Any], bool]:
    """Return (config_dict, valid_flag). valid_flag indicates file existed and had a valid dict JSON."""
    if not os.path.exists(path):
        return {}, False
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            if content.strip():
                data = json.loads(content)
                if isinstance(data, dict):
                    return data, True
            return {}, False
    except (OSError, json.JSONDecodeError):
        return {}, False

def _build_env_map() -> Dict[str, Any]:
    return {
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

def _apply_env_overrides(config: Dict[str, Any], env_map: Dict[str, Any]) -> None:
    for key, value in env_map.items():
        if value is not None:
            config[key] = _cast_env_value(key, str(value))

def _write_config(path: str, config: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

def load_config() -> Dict[str, Any]:
    """
    Build configuration with precedence: FILE > ENV > DEFAULTS.
    If the config file is missing, empty, or invalid JSON, it will be created
    at CONFIG_PATH with the merged values (env overriding defaults when no file exists).
    """
    # 1) Start from defaults
    config: Dict[str, Any] = dict(DEFAULT_CONFIG)

    # 2) Read file config (if available)
    file_config, file_valid = _read_file_config(CONFIG_PATH)

    # 3) Apply environment variables (override defaults)
    env_map = _build_env_map()
    _apply_env_overrides(config, env_map)

    # 4) Apply file values last so FILE > ENV > DEFAULTS
    if file_valid:
        config.update(file_config)

    # 5) Ensure the config file exists and is valid; if not, create/update it
    if not file_valid:
        _write_config(CONFIG_PATH, config)
    return config

def save_config(config: Dict[str, Any]):
    _write_config(CONFIG_PATH, config)
