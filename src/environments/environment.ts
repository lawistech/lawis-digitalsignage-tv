// environment.ts
export const environment = {
  production: false,
  apiUrl: 'https://kwfeyczkjhyxnlrkhlqt.supabase.co/rest/v1',
  supabaseUrl: 'https://kwfeyczkjhyxnlrkhlqt.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3ZmV5Y3pramh5eG5scmtobHF0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzkxNjQ0NzQsImV4cCI6MjA1NDc0MDQ3NH0.RTbkIrIHWCdzY6xXfV2957n1MX4Mi3Hs7W9OYnjI9OI',
  wsUrl: 'wss://kwfeyczkjhyxnlrkhlqt.supabase.co/realtime/v1',
  logLevel: 0, // Debug level
  refreshInterval: 10000, // 10 seconds
  heartbeatInterval: 60000, // 1 minute
  maxCacheSize: 500 * 1024 * 1024, // 500 MB
  appVersion: '1.0.0'
};