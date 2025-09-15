// API client for Python backend
// Problem bisher: Bei Zugriff von einem anderen Gerät im LAN zeigt 'localhost:8001' auf das dortige Gerät statt auf den Server.
// Lösung: Falls NEXT_PUBLIC_BACKEND_URL nicht gesetzt ist, dynamisch die Host-IP/Domain des Frontends nutzen.
// Optionaler Port override via NEXT_PUBLIC_BACKEND_PORT.
let resolvedBase = process.env.NEXT_PUBLIC_BACKEND_URL;
const backendPort = process.env.NEXT_PUBLIC_BACKEND_PORT || '8001';
if (!resolvedBase && typeof window !== 'undefined') {
  const { protocol, hostname, port } = window.location;
  const isStandardPort = (protocol === 'https:' && (port === '' || port === '443')) || (protocol === 'http:' && (port === '' || port === '80'));
  // If we're on HTTPS (nginx) or a standard port, prefer same-origin without explicit port
  // Else (e.g., local dev on :3000) target the backend port explicitly
  if (protocol === 'https:' || isStandardPort) {
    resolvedBase = `${protocol}//${hostname}`;
  } else {
    resolvedBase = `${protocol}//${hostname}:${backendPort}`;
  }
}
// Fallback (Dev Einzelstart): localhost
export const BACKEND_URL = resolvedBase || 'http://localhost:8001';
// Optional: kurze Debug-Ausgabe einmalig
declare global {
  interface Window { __BACKEND_URL_LOGGED__?: boolean }
}
if (typeof window !== 'undefined' && !window.__BACKEND_URL_LOGGED__) {
  window.__BACKEND_URL_LOGGED__ = true;
  console.log('[api-client] BACKEND_URL =', BACKEND_URL);
}

export interface RFIDData {
  tag_id: string;
  customer_name: string;
  part_number: string;
  description: string;
}

export interface PasswordRequest {
  password: string;
}

export interface PasswordResponse {
  success: boolean;
  message: string;
}

export interface RFIDTag {
  tag_id: string;
  customer_name: string;
  part_number: string;
  description: string;
  last_scanned: string;
}

export interface OPCUAStatus {
  enabled: boolean;
  available: boolean;
  connection_status: string;
  server_url?: string;
  node_id?: string;
  last_updated?: string;
  current_value?: {
    value: unknown;
    data_type: string;
    timestamp: string;
  };
}

export interface OPCUAValueResponse {
  success: boolean;
  data: {
    value: unknown;
    data_type: string;
    timestamp: string;
  };
  last_updated: string;
}

interface PicturesByPartResponse { success: boolean; files: string[]; count: number }

class APIClient {
  private readonly baseURL: string;

  constructor(baseURL: string = BACKEND_URL) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

  return response.json() as Promise<T>;
  }

  // Health check
  async healthCheck() {
    return this.request('/api/health');
  }

  // Password verification
  async verifyPassword(password: string): Promise<PasswordResponse> {
    return this.request<PasswordResponse>('/api/verify-password', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  }

  // Customer HTML operations
  async getCustomerHTML(): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/customer-html`);
    return response.text();
  }

  async uploadCustomerHTML(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseURL}/api/customer-html`, {
      method: 'POST',
      body: formData,
    });

    return response.text();
  }

  // RFID operations
  async processRFIDScan(data: RFIDData) {
    return this.request('/api/rfid/scan', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getRFIDTags(): Promise<RFIDTag[]> {
    return this.request<RFIDTag[]>('/api/rfid/tags');
  }

  // Format data operations
  async getFormatData() {
    return this.request('/api/format-data');
  }

  async getFormatParts(): Promise<{formatParts: string[], count: number, message: string}> {
    return this.request('/api/format-parts');
  }

  // Main table rows (parsed <tr> blocks)
  async getMainTableRows(options?: { asHtml?: boolean; withMeta?: boolean; duplicateCaption?: boolean; stripWhitespace?: boolean }) {
    const { asHtml = false, withMeta = true, duplicateCaption = true, stripWhitespace = false } = options || {};
    const qs = new URLSearchParams({
      as_html: asHtml ? 'true' : 'false',
      with_meta: withMeta ? 'true' : 'false',
      duplicate_caption: duplicateCaption ? 'true' : 'false',
      strip_whitespace: stripWhitespace ? 'true' : 'false'
    });
    const endpoint = `/api/main-table-rows?${qs.toString()}`;
    return this.request(endpoint);
  }

  async getFormats() {
    return this.request('/api/formats');
  }

  async getFormatPartsPerFormat() {
    return this.request('/api/format-parts-per-format');
  }

  // Format part assignments
  async getFormatAssignments() {
    return this.request('/api/format-assignments');
  }
  async getFormatAssignment(formatPart: string) {
    return this.request(`/api/format-assignments/${encodeURIComponent(formatPart)}`);
  }
  async assignRFIDToFormatPart(formatPart: string, rfidTagId: string) {
    return this.request('/api/format-assignments', {
      method: 'POST',
      body: JSON.stringify({ format_part: formatPart, rfid_tag_id: rfidTagId })
    });
  }
  async unassignRFIDFromFormatPart(formatPart: string) {
    return this.request(`/api/format-assignments/${encodeURIComponent(formatPart)}`, { method: 'DELETE' });
  }

  // Live current tag IDs (recently seen)
  async getCurrentRFIDTagIds() {
    return this.request('/api/current-rfid-tag-ids');
  }
  async getLiveEventIds() {
    return this.request('/api/live-event-ids');
  }

  // OPC UA methods
  async getOPCUAStatus(): Promise<OPCUAStatus> {
    return this.request('/api/opc-ua/status');
  }

  async getOPCUAValue(): Promise<OPCUAValueResponse> {
    return this.request('/api/opc-ua/value');
  }

  async refreshOPCUAValue(): Promise<OPCUAValueResponse> {
    return this.request('/api/opc-ua/refresh', {
      method: 'POST',
    });
  }

  async reconnectOPCUA(): Promise<{success: boolean, message: string, status: string}> {
    return this.request('/api/opc-ua/reconnect', {
      method: 'POST',
    });
  }

  // Pictures
  async getPicturesByPart(formatPart: string): Promise<PicturesByPartResponse> {
    const endpoint = `/api/pictures/by-part/${encodeURIComponent(formatPart)}`;
    return this.request<PicturesByPartResponse>(endpoint);
  }
}

// Export a default instance
export const apiClient = new APIClient();

// Hook for React components
export function useAPI() {
  return apiClient;
}
