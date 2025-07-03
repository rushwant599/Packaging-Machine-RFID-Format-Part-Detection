import os
import json
from typing import Dict, Any

CONFIG_PATH = os.environ.get("CONFIG_PATH", "data/config.json")

DEFAULT_CONFIG = {
    "OPC_UA_SERVER_URL": "opc.tcp://192.168.18.8:4840",
    "OPC_UA_NODE_ID": "ns=2;s=.G_HMI.stCM.sFormatAktiv",
    "OPC_UA_ENABLED": True,
    "RFID_OPC_ENABLED": False
}

def load_config() -> Dict[str, Any]:
    if not os.path.exists(CONFIG_PATH):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(config: Dict[str, Any]):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
