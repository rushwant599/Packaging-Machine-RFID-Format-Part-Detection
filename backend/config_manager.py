import os
import json
from typing import Dict, Any

CONFIG_PATH = os.environ.get("CONFIG_PATH", "/app/data/config.json")

#Default configuration
DEFAULT_CONFIG = {
    #PLC OPC UA
    "OPC_UA_SERVER_URL": "opc.tcp://IP-Address-PLC:4840",
    "OPC_UA_NODE_ID": "ns=2;s=.G_HMI.stCM.sFormatAktiv",
    "OPC_UA_ENABLED": False,
    #RFID OPC UA 
    "OPC_UA_EVENT_ENABLED": False,
    "OPC_UA_EVENT_SERVER_URL": "opc.tcp://IP-Address-RFID:4840",
    "OPC_UA_EVENT_TYPE": "ns=4;i=6050",
    "OPC_UA_EVENT_INTERVAL_MS": 500,
    "OPC_UA_EVENT_MAX_EVENTS": 500,
    # Theme color for UI
    "THEME_COLOR": "#1976d2"
}

# Helper functions for config management
def _cast_env_value(key: str, value: str) -> Any:
    """Cast env string to the type expected by the default config for that key."""
    if key.endswith("ENABLED"):
        return str(value).strip().lower() == "true"
    default_val = DEFAULT_CONFIG.get(key)
    if default_val is None:
        return value
    try:
        if isinstance(default_val, int) and not isinstance(default_val, bool):
            return int(value)
    except (TypeError, ValueError):
        return value
    return value

# Read existing config file
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

# Build env var map
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
        "THEME_COLOR": os.environ.get("THEME_COLOR"),
    }

# Apply env overrides
def _apply_env_overrides(config: Dict[str, Any], env_map: Dict[str, Any]) -> None:
    for key, value in env_map.items():
        if value is not None:
            config[key] = _cast_env_value(key, str(value))

# Write config to file
def _write_config(path: str, config: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        print(f"[config_manager] Writing config to: {path}")
    except Exception:
        pass
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

# Public API
def load_config() -> Dict[str, Any]:
    """
    Build configuration with precedence: FILE > ENV > DEFAULTS.
    If the config file is missing, empty, or invalid JSON, it will be created
    at CONFIG_PATH with the merged values (env overriding defaults when no file exists).
    """
    # 1) defaults
    config: Dict[str, Any] = dict(DEFAULT_CONFIG)

    # 2) config (if available)
    file_config, file_valid = _read_file_config(CONFIG_PATH)

    # 3) environment variables (override defaults)
    env_map = _build_env_map()
    _apply_env_overrides(config, env_map)

    if file_valid:
        config.update(file_config)

    if not file_valid:
        _write_config(CONFIG_PATH, config)
    return config

# Public API
def save_config(config: Dict[str, Any]):
    _write_config(CONFIG_PATH, config)
