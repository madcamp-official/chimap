/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_MODE?: "demo" | "live";
  readonly VITE_NAVER_MAP_NCP_KEY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
