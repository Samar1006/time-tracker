/** Minimal Web Speech API types (not in all TS lib.dom versions). */
interface LiveSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface LiveSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: LiveSpeechRecognitionResult;
}

interface LiveSpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: LiveSpeechRecognitionResultList;
}

interface LiveSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: LiveSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Browser SpeechRecognition with interim results for live captioning while recording. */
type SpeechRecognitionCtor = new () => LiveSpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class LiveSpeechRecognition {
  private recognition: LiveSpeechRecognitionInstance | null = null;
  private finalized = '';

  constructor(private readonly onUpdate: (text: string) => void) {}

  get supported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  start(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    this.finalized = '';
    this.onUpdate('');

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || 'en-US';

    recognition.onresult = (event: LiveSpeechRecognitionEvent) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          this.finalized += text;
        } else {
          interim += text;
        }
      }
      this.onUpdate((this.finalized + interim).trim());
    };

    recognition.onerror = () => {
      // Keep recording; live captions are best-effort when the API is unavailable.
    };

    recognition.start();
    this.recognition = recognition;
  }

  stop(): void {
    if (!this.recognition) return;
    this.recognition.onresult = null;
    this.recognition.onerror = null;
    this.recognition.stop();
    this.recognition = null;
  }
}
