// API client for Python backend
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

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

class APIClient {
  private baseURL: string;

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

    return response.json();
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

  async getFormats() {
    return this.request('/api/formats');
  }

  async getFormatPartsPerFormat() {
    return this.request('/api/format-parts-per-format');
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
}

// Export a default instance
export const apiClient = new APIClient();

// Hook for React components
export function useAPI() {
  return apiClient;
}
