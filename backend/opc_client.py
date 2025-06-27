"""
OPC UA Client Module
Handles OPC UA server connections, node monitoring, and data retrieval.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any, Callable, List

# OPC UA imports
try:
    from asyncua import Client, ua
    OPC_UA_AVAILABLE = True
except ImportError:
    OPC_UA_AVAILABLE = False
    logging.warning("OPC UA library not available. OPC UA features will be disabled.")

logger = logging.getLogger(__name__)

class OPCUAClient:
    """OPC UA Client for connecting to servers and reading node values"""
    
    def __init__(self, server_url: str, node_id: str):
        self.server_url = server_url
        self.node_id = node_id
        self.client = None
        self.node = None
        self.is_connected = False
        
    async def connect(self) -> bool:
        """Connect to OPC UA server and get node reference"""
        if not OPC_UA_AVAILABLE:
            logger.error("OPC UA library not available")
            return False
            
        try:
            logger.info(f"Connecting to OPC UA server: {self.server_url}")
            self.client = Client(url=self.server_url)
            await self.client.connect()
            
            # Get the node
            self.node = self.client.get_node(self.node_id)
            
            # Test node access
            await self.node.read_value()
            
            self.is_connected = True
            logger.info(f"Successfully connected to OPC UA server and node {self.node_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to OPC UA server: {e}")
            self.is_connected = False
            return False
    
    async def disconnect(self):
        """Disconnect from OPC UA server"""
        if self.client:
            try:
                await self.client.disconnect()
                logger.info("Disconnected from OPC UA server")
            except Exception as e:
                logger.error(f"Error disconnecting from OPC UA server: {e}")
            finally:
                self.client = None
                self.node = None
                self.is_connected = False
    
    async def read_node_value(self) -> Optional[Dict[str, Any]]:
        """Read current value from the subscribed node"""
        if not self.is_connected or not self.node:
            return None
            
        try:
            value = await self.node.read_value()
            data_type = await self.node.read_data_type_as_variant_type()
            
            return {
                "value": value,
                "data_type": str(data_type),
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error reading OPC UA node value: {e}")
            return None


class OPCUAManager:
    """High-level manager for OPC UA operations and state management"""
    
    def __init__(self, server_url: str, node_id: str, enabled: bool = True):
        self.server_url = server_url
        self.node_id = node_id
        self.enabled = enabled
        self.client: Optional[OPCUAClient] = None
        self.current_value: Optional[Dict[str, Any]] = None
        self.last_updated: Optional[datetime] = None
        self.connection_status = "disconnected"
        self.monitoring_task: Optional[asyncio.Task] = None
        
        # Event system for value changes
        self.value_change_callbacks: List[Callable[[Dict[str, Any]], None]] = []
        self.last_notified_value = None
    
    def add_value_change_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """Add a callback that will be called when the value changes"""
        self.value_change_callbacks.append(callback)
    
    def remove_value_change_callback(self, callback: Callable[[Dict[str, Any]], None]):
        """Remove a value change callback"""
        if callback in self.value_change_callbacks:
            self.value_change_callbacks.remove(callback)
    
    async def _notify_value_change(self, new_value: Dict[str, Any]):
        """Notify all callbacks about value change"""
        # Only notify if value actually changed
        current_val = new_value.get("value")
        if current_val != self.last_notified_value:
            self.last_notified_value = current_val
            logger.info(f"OPC UA value changed to: {current_val}")
            
            # Call all registered callbacks
            for callback in self.value_change_callbacks:
                try:
                    if asyncio.iscoroutinefunction(callback):
                        await callback(new_value)
                    else:
                        callback(new_value)
                except Exception as e:
                    logger.error(f"Error in value change callback: {e}")

    async def start_monitoring(self):
        """Start the background monitoring task"""
        if not self.enabled:
            logger.info("OPC UA monitoring disabled")
            return
            
        if self.monitoring_task and not self.monitoring_task.done():
            logger.warning("OPC UA monitoring already running")
            return
            
        logger.info("Starting OPC UA monitoring task")
        self.monitoring_task = asyncio.create_task(self._monitor_loop())
    
    async def stop_monitoring(self):
        """Stop the background monitoring task"""
        if self.monitoring_task:
            self.monitoring_task.cancel()
            try:
                await self.monitoring_task
            except asyncio.CancelledError:
                pass
            self.monitoring_task = None
        
        if self.client:
            await self.client.disconnect()
            self.client = None
    
    async def _monitor_loop(self):
        """Background monitoring loop"""
        while True:
            try:
                if self.client is None:
                    self.client = OPCUAClient(self.server_url, self.node_id)
                
                if not self.client.is_connected:
                    logger.info("Attempting to connect to OPC UA server...")
                    success = await self.client.connect()
                    self.connection_status = "connected" if success else "error: Connection failed"
                    
                if self.client.is_connected:
                    # Read node value
                    value_data = await self.client.read_node_value()
                    if value_data:
                        # Check if value changed and notify callbacks
                        old_value = self.current_value
                        self.current_value = value_data
                        self.last_updated = datetime.now()
                        self.connection_status = "connected"
                        
                        # Notify callbacks if value changed
                        if old_value is None or old_value.get("value") != value_data.get("value"):
                            await self._notify_value_change(value_data)
                    
                    await asyncio.sleep(5)  # Update every 5 seconds
                else:
                    # If not connected, wait longer before retry
                    await asyncio.sleep(15)
                    
            except asyncio.CancelledError:
                logger.info("OPC UA monitoring task cancelled")
                break
            except Exception as e:
                logger.error(f"Error in OPC UA monitoring task: {e}")
                self.connection_status = f"error: {str(e)}"
                await asyncio.sleep(10)
    
    async def get_status(self) -> Dict[str, Any]:
        """Get current OPC UA status"""
        return {
            "enabled": self.enabled,
            "available": OPC_UA_AVAILABLE,
            "connection_status": self.connection_status,
            "server_url": self.server_url if self.enabled else None,
            "node_id": self.node_id if self.enabled else None,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None,
            "current_value": self.current_value
        }
    
    async def get_current_value(self) -> Optional[Dict[str, Any]]:
        """Get the current node value"""
        return self.current_value
    
    async def refresh_value(self) -> Optional[Dict[str, Any]]:
        """Force refresh of the node value"""
        if not self.enabled or not OPC_UA_AVAILABLE:
            return None
            
        if not self.client or not self.client.is_connected:
            return None
        
        try:
            value_data = await self.client.read_node_value()
            if value_data:
                self.current_value = value_data
                self.last_updated = datetime.now()
                return value_data
        except Exception as e:
            logger.error(f"Error refreshing OPC UA value: {e}")
        
        return None
    
    async def reconnect(self) -> bool:
        """Force reconnection to OPC UA server"""
        if not self.enabled or not OPC_UA_AVAILABLE:
            return False
        
        try:
            # Disconnect if connected
            if self.client and self.client.is_connected:
                await self.client.disconnect()
            
            # Create new client and connect
            self.client = OPCUAClient(self.server_url, self.node_id)
            success = await self.client.connect()
            self.connection_status = "connected" if success else "error: Reconnection failed"
            
            return success
            
        except Exception as e:
            logger.error(f"Error reconnecting to OPC UA: {e}")
            self.connection_status = f"error: {str(e)}"
            return False
