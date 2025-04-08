// player-state.model.ts
export interface PlayerState {
    isPlaying: boolean;
    isOnline: boolean;
    currentPlaylistId: string | null;
    currentPlaylistName: string;
    currentItemIndex: number;
    totalItems: number;
    lastUpdated: Date;
  }