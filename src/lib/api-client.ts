let resolvedBase = process.env.NEXT_PUBLIC_BACKEND_URL;
const backendPort = process.env.NEXT_PUBLIC_BACKEND_PORT || '8001';

if (!resolvedBase && typeof window !== 'undefined') {
  try {
    const origin = window.location.origin;
    if (origin && origin.trim()) {
      resolvedBase = origin;
    }
  } catch {
  }
}

export const BACKEND_URL = resolvedBase || `http://localhost:${backendPort}`;

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
  async getCustomerHTML(lang?: string): Promise<string> {
    const qs = new URLSearchParams();
    if (lang) qs.set('lang', lang);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const response = await fetch(`${this.baseURL}/api/customer-html${suffix}`);
    return response.text();
  }

  // Upload customer HTML file
  async uploadCustomerHTML(file: File, lang?: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    if (lang) formData.append('lang', lang);

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

  // Format data operations
  async getFormatData(lang?: string) {
    const qs = new URLSearchParams();
    if (lang) qs.set('lang', lang);
    return this.request(`/api/format-data${qs.toString() ? `?${qs.toString()}` : ''}`);
  }

  async getFormatParts(): Promise<{ formatParts: string[], count: number, message: string }> {
    return this.request('/api/format-parts');
  }

  // Main table rows (parsed <tr> blocks)
  async getMainTableRows(options?: { asHtml?: boolean; withMeta?: boolean; duplicateCaption?: boolean; stripWhitespace?: boolean; lang?: string }) {
    const { asHtml = false, withMeta = true, duplicateCaption = true, stripWhitespace = false, lang } = options || {};
    const qs = new URLSearchParams({
      as_html: asHtml ? 'true' : 'false',
      with_meta: withMeta ? 'true' : 'false',
      duplicate_caption: duplicateCaption ? 'true' : 'false',
      strip_whitespace: stripWhitespace ? 'true' : 'false'
    });
    if (lang) qs.set('lang', lang);
    const endpoint = `/api/main-table-rows?${qs.toString()}`;
    return this.request(endpoint);
  }

  // Formats
  async getFormats(lang?: string) {
    const qs = new URLSearchParams();
    if (lang) qs.set('lang', lang);
    return this.request(`/api/formats${qs.toString() ? `?${qs.toString()}` : ''}`);
  }

  // Format parts per format
  async getFormatPartsPerFormat(lang?: string) {
    const qs = new URLSearchParams();
    if (lang) qs.set('lang', lang);
    return this.request(`/api/format-parts-per-format${qs.toString() ? `?${qs.toString()}` : ''}`);
  }

  // Format part assignments
  async getFormatAssignments() {
    return this.request('/api/format-assignments');
  }

  // Single format part assignment
  async getFormatAssignment(formatPart: string) {
    return this.request(`/api/format-assignments/${encodeURIComponent(formatPart)}`);
  }

  // Assign / unassign RFID tag to format part
  async assignRFIDToFormatPart(formatPart: string, rfidTagId: string) {
    return this.request('/api/format-assignments', {
      method: 'POST',
      body: JSON.stringify({ format_part: formatPart, rfid_tag_id: rfidTagId })
    });
  }
  
  // Unassign RFID tag from format part
  async unassignRFIDFromFormatPart(formatPart: string) {
    return this.request(`/api/format-assignments/${encodeURIComponent(formatPart)}`, { method: 'DELETE' });
  }
  
  // Live event IDs
  async getLiveEventIds() {
    return this.request('/api/live-event-ids');
  }

  // OPC UA methods
  async getOPCUAStatus(): Promise<OPCUAStatus> {
    return this.request('/api/opc-ua/status');
  }

  // Get current OPC UA value
  async getOPCUAValue(): Promise<OPCUAValueResponse> {
    return this.request('/api/opc-ua/value');
  }

  // Refresh OPC UA value
  async refreshOPCUAValue(): Promise<OPCUAValueResponse> {
    return this.request('/api/opc-ua/refresh', {
      method: 'POST',
    });
  }

  // Reconnect OPC UA
  async reconnectOPCUA(): Promise<{ success: boolean, message: string, status: string }> {
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
