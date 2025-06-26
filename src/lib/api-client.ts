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
}

// Export a default instance
export const apiClient = new APIClient();

// Hook for React components
export function useAPI() {
  return apiClient;
}
