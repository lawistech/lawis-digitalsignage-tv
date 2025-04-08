// device-info.model.ts
export interface DeviceInfo {
    browser: string;
    resolution: string;
    connectionType: string;
    timestamp: string;
    ipAddress: string;
    os: string;
    macAddress?: string;
    hardwareModel?: string;
    serialNumber?: string;
  }