/// <reference types="vite/client" />

interface MichealDesktopBridge {
  readonly platform: string;
  readonly isElectron: true;
  /** Returns JPEG base64 (no data: prefix) or null */
  captureScreen?: () => Promise<string | null>;
}

interface ImportMetaEnv {
  readonly VITE_MICHEAL_URL: string;
  readonly VITE_MICHEAL_TOKEN: string;
  /** @deprecated use VITE_MICHEAL_URL */
  readonly VITE_VIGIL_URL?: string;
  /** @deprecated use VITE_MICHEAL_TOKEN */
  readonly VITE_VIGIL_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
}

declare var SpeechRecognition: { new (): SpeechRecognition };
declare var webkitSpeechRecognition: { new (): SpeechRecognition };

interface Window {
  readonly michealDesktop?: MichealDesktopBridge;
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
