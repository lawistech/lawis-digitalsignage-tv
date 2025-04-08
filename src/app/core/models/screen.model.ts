// screen.model.ts

// screen.model.ts

export interface CreateScreenDto {
    name: string;
    channel_id: string;
    channel_name: string;
    area_id: string;
    status: 'online' | 'offline' | 'maintenance' | 'error';
    resolution: string;
    orientation: 'landscape' | 'portrait';
    last_ping: string;
    current_playlist: string | null;  // Changed from optional to nullable
    next_playlist: string | null;     // Changed from optional to nullable
    current_playlist_started_at: string | null; 
    schedule: {
      current: {
        playlist_id: string;
        start_time: string;
        end_time: string;
        priority: number;
      } | null;
      upcoming: Array<{
        playlist_id: string;
        start_time: string;
        end_time: string;
        priority: number;
      }>;
    } | null;                        // Changed from optional to nullable
    hardware: ScreenHardware;
    network: NetworkConfig;
    location: LocationInfo;
    settings: ScreenSettings;
    analytics: ScreenAnalytics;
    maintenance: MaintenanceInfo;
    tags: string[];                  // Changed from optional to required array
  }
  
  // screen.model.ts
  export interface Screen {
    id: string;
    name: string;
    channel_id: string;
    channel_name: string;
    area_id: string;
    status: 'online' | 'offline' | 'maintenance' | 'error';
    resolution: string;
    orientation: 'landscape' | 'portrait';
    last_ping: string;
    current_playlist: string | null;
    current_playlist_started_at: string | null;  // Add this field
    next_playlist: string | null;
    schedule: {
      current: {
        playlist_id: string;
        start_time: string;
        end_time: string;
        priority: number;
      } | null;
      upcoming: Array<{
        playlist_id: string;
        start_time: string;
        end_time: string;
        priority: number;
      }>;
    } | null;
    hardware: ScreenHardware;
    network: NetworkConfig;
    location: LocationInfo;
    settings: ScreenSettings;
    analytics: ScreenAnalytics;
    maintenance: MaintenanceInfo;
    tags: string[];
    created_at?: string;
    updated_at?: string;
  }
  
  export interface ScreenFilters {
    areaId: string;
    status: '' | 'online' | 'offline' | 'maintenance' | 'error';
  }
  
  export interface ScreenHardware {
    model: string;
    manufacturer: string;
    serial_number: string;
    display_size: string;
    brightness_level: number;
    contrast_ratio: string;
    supported_resolutions: string[];
    operating_hours: number;
  }
  
  export interface NetworkConfig {
    ip_address: string;
    mac_address: string;
    connection_type: string;
    subnet: string;
    gateway: string;
    dns: string[];
    last_config_update: string;
  }
  
  export interface LocationInfo {
    building: string;
    floor: string;
    room: string;
    area: string;
  }
  
  export interface ScreenSettings {
    auto_start: boolean;
    auto_update: boolean;
    remote_control: boolean;
    power_schedule: {
      enabled: boolean;
      power_on: string;
      power_off: string;
      days_active: string[];
    };
    content_caching: boolean;
    fallback_content: string;
    refresh_interval: number;
    screen_rotation: number;
  }
  
  export interface ScreenAnalytics {
    uptime: number;
    last_reboot: string;
    average_playback_time: number;
    errors: {
      count: number;
      last_error: string;
      error_history: any[];
    };
    performance: {
      cpu_usage: number;
      memory_usage: number;
      storage_usage: number;
      temperature: number;
    };
  }
  
  export interface MaintenanceInfo {
    last_maintenance: string;
    next_scheduled_maintenance: string;
    maintenance_history: any[];
    warranties: {
      status: string;
      expiration_date: string;
      provider: string;
    };
  }
  
  
  export interface PlaylistScheduleBase {
    playlist_id: string;
    start_time: string;
    end_time: string;
    priority: number;
    days_of_week?: string[]; 
  }
  
  export interface PlaylistSchedule extends PlaylistScheduleBase {
    playlist_name: string;
    days_of_week: string[];
  }
  
  export interface ScreenSchedule {
    current: PlaylistScheduleBase | null;
    upcoming: PlaylistScheduleBase[];
  }
  