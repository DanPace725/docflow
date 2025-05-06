/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_FORM_RECOGNIZER_ENDPOINT: string;
  readonly VITE_AZURE_FORM_RECOGNIZER_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
