/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NYA_API_KEY?: string
  readonly VITE_NYA_API_URL?: string
  readonly VITE_NYA_EDIT_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
