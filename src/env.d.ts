/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AZURE_FORM_RECOGNIZER_ENDPOINT: "https://pos.cognitiveservices.azure.com/";
  readonly VITE_AZURE_FORM_RECOGNIZER_KEY: "";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
