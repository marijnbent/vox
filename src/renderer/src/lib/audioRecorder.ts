import { writable } from 'svelte/store';
import { manageMusicOnRecordStart, restoreMusicAfterRecordStop } from './mediaManager';

export const recordingStatus = writable<'idle' | 'recording' | 'processing' | 'error'>('idle');
export const transcriptionResult = writable<string | null>(null);
export const transcriptionError = writable<string | null>(null);

let mediaRecorder: MediaRecorder | null = null;
let cancelRequested = false;
let audioChunks: Blob[] = [];
let audioStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;

const SOUND_START = 'Tink';
const SOUND_STOP = 'Submarine';
const SOUND_CANCEL = 'Basso';

const DESIRED_AUDIO_BITRATE = 32000;

export function initializeAudioRecorder(): () => void {
  window.api.log('info', 'Initializing audio recorder listeners...');

  const cleanupStart = window.api.onStartRecording(() => {
    cancelRequested = false;
    startRecording();
  });
  const cleanupStop = window.api.onStopRecording(() => {
    stopRecording();
  });
  const cleanupCancel = window.api.onCancelRecording(() => {
      window.api.log('info', 'Cancel recording requested (IPC). Setting flag, playing sound, and forcing cleanup.');
      window.api.playSystemSound(SOUND_CANCEL).catch(err => window.api.log('warn', `Failed to play cancel sound (IPC): ${err}`));
      cancelRequested = true;
      const recorderToStop = mediaRecorder;
      const streamToStop = audioStream;
      mediaRecorder = null;
      audioStream = null;
      audioChunks = [];
      streamToStop?.getTracks().forEach(track => {
          try { track.stop(); } catch (e) { window.api.log('warn', 'Error stopping audio track during cancel:', e); }
      });
      window.api.log('debug', 'Skipping mediaRecorder.stop() during forced cancel.');
  });
  const cleanupResult = window.api.onTranscriptionResult(handleTranscriptionResult);
  const cleanupError = window.api.onTranscriptionError(handleTranscriptionError);
  const cleanupStatus = window.api.onRecordingStatus(handleRecordingStatus);

  return () => {
    window.api.log('info', 'Cleaning up audio recorder listeners...');
    cleanupStart();
    cleanupStop();
    cleanupCancel();
    cleanupResult();
    cleanupError();
    cleanupStatus();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch(e) {}
    }
    if (audioStream) {
      audioStream.getTracks().forEach(track => { try {track.stop();} catch(e) {} });
    }
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(e => window.api.log('warn', 'Error closing AudioContext on cleanup:', e));
        audioContext = null;
    }
    cancelRequested = false;
    // Ensure music is restored if cleanup is called during an active managed session
    // However, primary restoration points are more specific to stop/cancel events.
    // restoreMusicAfterRecordStop(); // Decided against a generic call here to avoid unintended restorations.
  };
}

async function startRecording(): Promise<void> {
  window.api.log('info', 'Start recording requested...');
  cancelRequested = false;
  transcriptionResult.set(null);
  transcriptionError.set(null);

  if (mediaRecorder) {
    window.api.log('warn', `Start request ignored. Recorder instance already exists (state: ${mediaRecorder?.state}).`);
    return;
  }
  if (cancelRequested) {
     window.api.log('warn', 'Start request ignored. Cancel flag already set.');
     return;
  }

  let obtainedStream: MediaStream | null = null;
  let musicManaged = false;

  try {
    const transcriptionSettings = await window.api.getStoreValue("transcription") as any || {};
    if (transcriptionSettings.musicManagementEnabled && transcriptionSettings.musicManagementAction) {
      await manageMusicOnRecordStart(transcriptionSettings.musicManagementAction);
      musicManaged = true;
    }

    obtainedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (cancelRequested) {
        window.api.log('warn', 'Recording cancelled after getUserMedia was granted. Cleaning up stream.');
        obtainedStream?.getTracks().forEach(track => track.stop());
        if (musicManaged) await restoreMusicAfterRecordStop();
        return;
    }
    audioStream = obtainedStream;
    window.api.log('info', 'Microphone access granted.');

    const options = getSupportedMimeTypeAndOptions();
    window.api.log('info', `Using MediaRecorder options: ${JSON.stringify(options)}`);

    if (cancelRequested) {
        window.api.log('warn', 'Recording cancelled before creating MediaRecorder.');
        audioStream?.getTracks().forEach(track => track.stop());
        audioStream = null;
        if (musicManaged) await restoreMusicAfterRecordStop();
        return;
    }

    const localRecorder = new MediaRecorder(audioStream, options);
    mediaRecorder = localRecorder;
    audioChunks = [];

    localRecorder.ondataavailable = (event) => {
      if (cancelRequested) {
          return;
      }
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    localRecorder.onstop = async () => {
      const currentRecorderRef = mediaRecorder;
      const currentMimeType = currentRecorderRef?.mimeType || options.mimeType || 'audio/webm';
      window.api.log('info', `MediaRecorder stopped. Cancelled flag: ${cancelRequested}`);

      if (cancelRequested) {
          window.api.log('info', 'Recording cancelled (detected in onstop), discarding audio data.');
          cleanupAfterRecording(true);
          return;
      }

      // If not cancelled, it's a normal stop.
      await restoreMusicAfterRecordStop(); // Restore music before playing sound
      window.api.playSystemSound(SOUND_STOP).catch(err => window.api.log('warn', `Failed to play stop sound: ${err}`));


      if (audioChunks.length === 0) {
          window.api.log('warn', 'No audio data recorded (or cleared due to cancel).');
          cleanupAfterRecording(false); 
          return;
      }

      const audioBlob = new Blob(audioChunks, { type: currentMimeType });
      window.api.log('info', `Combined audio blob size: ${audioBlob.size} bytes, type: ${audioBlob.type}`);

      let processingError = null;
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();

        if (cancelRequested) {
            window.api.log('warn', 'Recording cancelled before audio processing/sending.');
            throw new Error("Cancelled before processing");
        }

        if (!audioContext || audioContext.state === 'closed') {
            try {
                 audioContext = new AudioContext();
            } catch (acError) {
                window.api.log('warn', 'Could not create AudioContext, falling back to default.', acError);
                audioContext = new AudioContext();
            }
        }

        let audioBuffer: AudioBuffer;
        try {
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        } catch (decodeError) {
             window.api.log('error', 'Audio decode failed:', decodeError);
             throw new Error(`Audio decode failed: ${decodeError.message}`);
        }

        window.api.log('info', `Audio decoded: Duration=${audioBuffer.duration.toFixed(2)}s, SampleRate=${audioBuffer.sampleRate}Hz`);

         if (cancelRequested) {
            window.api.log('warn', 'Recording cancelled just before sending to main process.');
            throw new Error("Cancelled before sending");
        }

        const audioPayload = { audioData: arrayBuffer, mimeType: currentMimeType };
        window.api.log('info', `Sending audio (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB) for transcription...`);
        await window.api.transcribeAudio(audioPayload);
        window.api.log('info', 'Audio data sent to main process.');

      } catch (error) {
        if (error.message.startsWith("Cancelled") || error.message.startsWith("Silent")) {
            window.api.log('info', `Processing skipped due to: ${error.message}`);
        } else {
            window.api.log('error', 'Error during audio processing or sending:', error);
            processingError = error;
        }
      } finally {
          cleanupAfterRecording(cancelRequested || (processingError && processingError.message.startsWith("Cancelled")));
          if (processingError && !processingError.message.startsWith("Cancelled") && !processingError.message.startsWith("Silent")) {
              handleTranscriptionError(`Processing error: ${processingError.message || processingError}`);
          }
      }
    };

    localRecorder.onerror = (event) => {
       window.api.log('error', 'MediaRecorder error:', (event as ErrorEvent).error || event);
       handleTranscriptionError(`Recording error: ${(event as ErrorEvent).error?.message || 'Unknown recording error'}`);
       cleanupAfterRecording(cancelRequested);
    };

    if (cancelRequested) {
         window.api.log('warn', 'Recording cancelled just before MediaRecorder.start().');
         cleanupAfterRecording(true);
         return;
    }

    try {
        localRecorder.start();
        window.api.playSystemSound(SOUND_START).catch(err => window.api.log('warn', `Failed to play start sound: ${err}`));
        window.api.log('info', `MediaRecorder started (Bitrate: ${localRecorder.audioBitsPerSecond || 'default'}, MimeType: ${localRecorder.mimeType}).`);
        window.api.notifyRecorderStarted();
    } catch (startError) {
         window.api.log('error', 'Error calling MediaRecorder.start():', startError);
         handleTranscriptionError(`Failed to start recorder: ${startError.message}`);
         cleanupAfterRecording(false);
    }

  } catch (err) {
     window.api.log('error', 'Error accessing microphone or starting recorder:', err);
     if (musicManaged) {
        await restoreMusicAfterRecordStop().catch(e => window.api.log('warn', 'Error restoring music in startRecording catch:', e));
     }
     let errorMessage = 'Unknown error';
     if (err instanceof Error) {
         errorMessage = err.message;
         if (err.name === 'NotAllowedError') {
             errorMessage = 'Microphone permission denied.';
         } else if (err.name === 'NotFoundError') {
             errorMessage = 'No microphone found.';
         } else if (err.name === 'NotReadableError') {
             errorMessage = 'Microphone is already in use or hardware error.';
         }
     }
     handleTranscriptionError(`Microphone access error: ${errorMessage}`);
     if (obtainedStream) {
        obtainedStream.getTracks().forEach(track => track.stop());
     }
     audioStream = null;
     mediaRecorder = null;
  }
}

async function cleanupAfterRecording(isCancellationOrSilence: boolean): Promise<void> {
    window.api.log('debug', `Cleaning up audio resources (Is Cancellation/Silence: ${isCancellationOrSilence})`);
    
    // Always attempt to restore music state during cleanup, especially for cancellations.
    // The mediaManager's internal state (originalMusicState) prevents issues if already restored.
    await restoreMusicAfterRecordStop().catch(e => window.api.log('warn', 'Error restoring music in cleanupAfterRecording:', e));

    audioStream?.getTracks().forEach(track => {
        try { track.stop(); } catch(e) { window.api.log('warn', 'Error stopping track in cleanup:', e); }
    });
    audioStream = null;
    mediaRecorder = null;
    audioChunks = [];
    window.api.log('debug', `Cleanup done, cancelRequested flag state preserved: ${cancelRequested}`);
}

export async function stopRecording(): Promise<void> {
  window.api.log('info', `Stop recording requested. Current state: ${mediaRecorder?.state}. Cancelled: ${cancelRequested}`);
  if (cancelRequested) {
      window.api.log('warn', 'Stop ignored because cancelRequested is true.');
      await cleanupAfterRecording(true);
      return;
  }
  const recorder = mediaRecorder;
  if (recorder && recorder.state === 'recording') {
    try {
        // restoreMusicAfterRecordStop() will be called in recorder.onstop for normal stops
        recorder.stop();
    } catch (e) {
        window.api.log('error', 'Error calling MediaRecorder.stop():', e);
        handleTranscriptionError(`Failed to stop recorder: ${e instanceof Error ? e.message : String(e)}`);
        await cleanupAfterRecording(false);
    }
  } else if (recorder && recorder.state === 'inactive') {
      window.api.log('warn', 'Stop requested but recorder is already inactive. Cleaning up.');
      await cleanupAfterRecording(false);
  } else {
     window.api.log('warn', `Stop requested but no active/inactive recorder found or state is ${recorder?.state}.`);
     await cleanupAfterRecording(false);
  }
}

function handleTranscriptionResult(text: string): void {
  window.api.log('info', `Transcription result received: "${text}"`);
  transcriptionResult.set(text);
  transcriptionError.set(null);
}

function handleTranscriptionError(error: string): void {
  window.api.log('error', `Transcription/Processing error received: ${error}`);
  transcriptionError.set(error);
  transcriptionResult.set(null);
}

function handleRecordingStatus(status: 'idle' | 'recording' | 'processing' | 'error'): void {
   window.api.log('debug', `[Renderer/audioRecorder] handleRecordingStatus received status from main: ${status}`);
   recordingStatus.set(status);
}

function getSupportedMimeTypeAndOptions(): MediaRecorderOptions {
    const types = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm;codecs=vp8',
        'audio/webm',
        'audio/ogg',
    ];

    let supportedMimeType = '';
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            supportedMimeType = type;
            break;
        }
    }

    if (!supportedMimeType) {
         window.api.log('warn', 'No preferred MIME type supported, using browser default.');
    }

    const options: MediaRecorderOptions = {};
    if (supportedMimeType) {
        options.mimeType = supportedMimeType;
    }
    options.audioBitsPerSecond = DESIRED_AUDIO_BITRATE;

    return options;
}

export function get<T>(store: { subscribe: (cb: (value: T) => void) => () => void }): T {
  let value: T;
  const unsubscribe = store.subscribe(v => value = v);
  unsubscribe();
  return value;
}