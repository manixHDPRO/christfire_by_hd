/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_SHOW_DEMO_HINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
