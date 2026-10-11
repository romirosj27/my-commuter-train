/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "1" builds the self-contained demo (mock data, no server). */
  readonly VITE_DEMO?: string;
}
