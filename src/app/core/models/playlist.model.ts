// playlist.model.ts
import { PlaylistSchedule } from "./screen.model";

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  duration: number; // in seconds
  items: PlaylistItem[];
  schedule?: PlaylistSchedule;
  lastModified: string;
  createdBy: string;
  status: 'active' | 'draft' | 'archived';
  tags?: string[];
  settings: PlaylistSettings;
}

export interface PlaylistSettings {
  autoPlay: boolean;
  loop: boolean;
  defaultMuted: boolean;
  transition: {
    type: 'fade' | 'slide' | 'none';
    duration: number;
  };
  defaultDuration: number; // default duration for static content
  scheduling: {
    enabled: boolean;
    startDate?: string;
    endDate?: string;
    priority: number;
  };
}

export interface TimeSlot {
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  daysOfWeek: (
    | 'Monday'
    | 'Tuesday'
    | 'Wednesday'
    | 'Thursday'
    | 'Friday'
    | 'Saturday'
    | 'Sunday'
  )[];
}

export interface PlaylistItem {
  schedule: any;
  id: string;
  type: 'image' | 'video' | 'webpage' | 'ticker';
  name: string;
  duration: number;
  content: {
    url: string;
    thumbnail?: string;
  };
  settings: {
    transition: 'fade' | 'slide' | 'none';
    transitionDuration: number;
    scaling: 'fit' | 'fill' | 'stretch';
    muted?: boolean;
    loop?: boolean;
  };
}

export interface CreatePlaylistDto {
  name: string;
  description?: string;
  settings: PlaylistSettings;
}

export interface UpdatePlaylistDto {
  name?: string;
  description?: string;
  settings?: Partial<PlaylistSettings>;
  status?: 'active' | 'draft' | 'archived';
}