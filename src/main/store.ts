import Store from 'electron-store'

interface DictionarySettings {
  words: string[]
}

interface TranscriptionSettings {
  provider: 'openai' | 'deepgram';
  openaiApiKey: string;
  openaiModel: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe';
  deepgramApiKey: string;
  deepgramModel: 'nova-3' | 'enhanced' | 'whisper-large';
}

interface EnhancementSettings {
  enabled: boolean;
  provider: 'openai' | 'gemini' | 'custom';
  openaiApiKey: string;
  openaiModel: 'gpt-4.1' | 'gpt-4.1-mini';
  openaiBaseUrl?: string;
  geminiApiKey: string;
  geminiModel: 'gemini-2.0-flash' | 'gemini-2.5-flash' | 'gemini-2.0-flash-lite';
  customApiKey: string;
  customModelName: string;
  customBaseUrl?: string;
  activePromptId: string;
  useTranscript: boolean;
  useContextScreen: boolean;
  useContextInputField: boolean;
  useContextClipboard: boolean;
  useDictionaryWordList: boolean;
}

interface EnhancementPrompt {
  id: string;
  name: string;
  template: string;
}

interface ShortcutSettings {
  pushToTalk: string
  toggleRecording: string
}

interface HistoryEntry {
  id: string
  text: string
  timestamp: number
  duration: number
  enhanced: boolean
}

interface StoreSchema {
  settings: {
    theme: 'cupcake' | 'dark';
    autoPaste: boolean;
  }
  dictionary: DictionarySettings
  transcription: TranscriptionSettings
  enhancements: EnhancementSettings;
  enhancementPrompts: EnhancementPrompt[];
  shortcuts: ShortcutSettings;
  history: HistoryEntry[];
}

const store = new Store<StoreSchema>({
  defaults: {
    settings: {
      theme: 'cupcake',
      autoPaste: true
    },
    dictionary: {
      words: []
    },
    transcription: {
      provider: 'deepgram',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini-transcribe',
      deepgramApiKey: '',
      deepgramModel: 'nova-3'
    },
    enhancements: {
      enabled: false,
      provider: 'openai',
      openaiApiKey: '',
      openaiModel: 'gpt-4.1-mini',
      openaiBaseUrl: '',
      geminiApiKey: '',
      geminiModel: 'gemini-2.0-flash-lite',
      customApiKey: '',
      customModelName: '',
      customBaseUrl: '',
      activePromptId: 'default',
      useTranscript: true,
      useContextScreen: false,
      useContextInputField: false,
      useContextClipboard: false,
      useDictionaryWordList: false
    },
    enhancementPrompts: [],
    shortcuts: {
        pushToTalk: 'CommandOrControl+Shift+Space',
        toggleRecording: 'CommandOrControl+Shift+R'
    },
    history: []
  }
})

export default store

export type { EnhancementSettings, EnhancementPrompt };