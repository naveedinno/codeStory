// Shared wire types. Keep this module free of Node/browser runtime imports.
export interface AloudStatus {
  engine?: string;
  jobId?: string;
  ok: true;
  paused: boolean;
  protocolVersion: number;
  rate?: number;
  running: boolean;
  service: string;
  state: {
    current?: number;
    message?: string;
    status?: 'starting' | 'generating' | 'reading' | 'done' | 'stopped' | 'error';
    total?: number;
  };
  [key: string]: unknown;
}

export interface AloudModel {
  id: string;
  name: string;
  detail?: string;
  ready: boolean;
  languages: string[];
  voices: Array<{ id: string; label: string; description?: string }>;
}

export interface AloudSettingsPatch {
  engine?: string;
  voice?: string;
  rate?: number;
}
