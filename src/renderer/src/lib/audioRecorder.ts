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
let musicManaged = false; // Added to track music state

// Define an interface for transcription settings for type safety
interface TranscriptionSettings {
  musicManagementEnabled?: boolean;
  musicManagementAction?: 'pause' | 'playpause'; // Adjust based on actual possible values
  musicManagementResumeOnStop?: boolean;
  // Add other relevant properties from your settings structure
}

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
      mediaRecorder = null;
      audioStream = null;
      audioChunks = [];
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
  };
}

async function startRecording(): Promise<void> {
  window.api.log('info', 'Start recording requested...');
  cancelRequested = false;
  transcriptionResult.set(null);
  transcriptionError.set(null);
  // Do not set recordingStatus to 'recording' yet.

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    window.api.log('warn', 'MediaRecorder already active. State:', mediaRecorder.state);
    return;
  }

  let obtainedStream: MediaStream | null = null;
  // musicManaged is now a module-level variable

  try {
    // 1. Explicitly check and request microphone permission
    let micPermissionStatus = await window.api.getMediaPermissionStatus('microphone');
    window.api.log('info', `Initial microphone permission status: ${micPermissionStatus}`);

    if (micPermissionStatus === 'not-determined') {
      window.api.log('info', 'Microphone permission not determined, requesting...');
      const permissionGranted = await window.api.requestMediaPermission('microphone');
      if (!permissionGranted) {
        window.api.log('warn', 'Microphone permission denied by user or system during request.');
        handleTranscriptionError('Microphone permission was not granted. Please grant access in System Settings.');
        return;
      }
      // Re-check status after request
      micPermissionStatus = await window.api.getMediaPermissionStatus('microphone');
      window.api.log('info', `Microphone permission status after request: ${micPermissionStatus}`);
    }

    if (micPermissionStatus === 'denied' || micPermissionStatus === 'restricted') {
      window.api.log('warn', `Microphone permission is ${micPermissionStatus}.`);
      handleTranscriptionError(`Microphone access is ${micPermissionStatus}. Please grant access in System Settings or via the app's Permissions page.`);
      return;
    } else if (micPermissionStatus !== 'granted') {
      window.api.log('warn', `Microphone permission status is unexpected or unavailable: ${micPermissionStatus}.`);
      handleTranscriptionError(`Microphone access is unavailable (status: ${micPermissionStatus}). Please check system settings.`);
      return;
    }

    window.api.log('info', 'Microphone permission is granted.');

    // 2. Manage Music (if enabled)
    const transcriptionSettings = await window.api.getStoreValue("transcription") as TranscriptionSettings || {};
    if (transcriptionSettings.musicManagementEnabled && transcriptionSettings.musicManagementAction) {
      window.api.log('info', `Music management: Attempting to ${transcriptionSettings.musicManagementAction} music.`);
      await window.api.controlMusic(transcriptionSettings.musicManagementAction === 'pause' ? 'pause' : 'playpause'); // Assuming 'playpause' for other actions
      musicManaged = true;
    }

    // 3. Check for cancellation after permission/music management
    if (cancelRequested) {
      window.api.log('warn', 'Recording cancelled after permission grant/music management, before getUserMedia.');
      await cleanupAfterRecording(true); // Pass true for cancellation
      return;
    }

    // Set status to 'recording' now that permissions are confirmed and we are proceeding
    recordingStatus.set('recording');
    window.api.updateRecordingStatus('recording'); // Inform main process
    window.api.notifyRecorderStarted(); // Notify main process recorder has started (or is attempting to)

    // 4. GetUserMedia
    window.api.log('info', 'Attempting to get user media (microphone).');
    obtainedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    window.api.log('info', 'Successfully obtained media stream.');


    if (cancelRequested) {
      window.api.log('warn', 'Recording cancelled after getUserMedia was granted. Cleaning up stream.');
      obtainedStream?.getTracks().forEach((track) => track.stop());
      await cleanupAfterRecording(true);
      return;
    }
    audioStream = obtainedStream;
    window.api.log("info", "Microphone access granted and stream obtained."); // Moved this log

    const options = getSupportedMimeTypeAndOptions();
    window.api.log("info", `Using MediaRecorder options: ${JSON.stringify(options)}`);

    if (cancelRequested) {
      window.api.log('warn', 'Recording cancelled before creating MediaRecorder.');
      audioStream?.getTracks().forEach((track) => track.stop());
      audioStream = null;
      await cleanupAfterRecording(true);
      return;
    }

    const localRecorder = new MediaRecorder(audioStream, options);
    mediaRecorder = localRecorder;
    audioChunks = [];

    localRecorder.ondataavailable = (event2) => {
      if (cancelRequested) {
          return;
      }
      if (event2.data.size > 0) {
        audioChunks.push(event2.data);
      }
    };

    localRecorder.onstop = async () => {
      const currentMimeType = mediaRecorder?.mimeType || options.mimeType || "audio/webm";
      
      // Prevent processing if it was a deliberate cancellation that already cleaned up
      if (cancelRequested && get(recordingStatus) === 'idle') {
          window.api.log('info', 'Recorder stopped due to cancellation, processing skipped.');
          return;
      }

      window.api.log('info', `MediaRecorder stopped. MimeType: ${currentMimeType}, Chunks: ${audioChunks.length}`);

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
      // Play start sound only after all checks and just before actual recording starts
      await window.api.playSystemSound(SOUND_START);
      localRecorder.start();
      window.api.log('info', 'MediaRecorder started.');
    } catch (startError) {
      window.api.log('error', 'Error starting MediaRecorder:', startError);
      handleTranscriptionError('Failed to start the audio recorder.');
      // Ensure cleanup if recorder.start() fails
      if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
      }
      mediaRecorder = null; // Ensure mediaRecorder is nulled
      await cleanupAfterRecording(true); // Treat as a cancellation/error
      return; // Exit startRecording
    }
  } catch (err) {
    window.api.log("error", "Error accessing microphone or starting recorder:", err);
    // Music managed flag should be handled here as well
    if (musicManaged) {
      const transcriptionSettings = await window.api.getStoreValue("transcription") as TranscriptionSettings || {};
      if (transcriptionSettings.musicManagementResumeOnStop) { // Or always resume on error
        window.api.log('info', 'Attempting to resume music playback due to error.');
        await window.api.controlMusic('play');
      }
      musicManaged = false; // Reset flag
    }

    let errorMessage = "Unknown error during recording setup.";
    if (err instanceof Error) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Microphone permission was denied.';
        // This should ideally be caught by the explicit permission check now,
        // but kept as a fallback.
        handleTranscriptionError(errorMessage + ' Please grant access in System Settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone found. Please ensure a microphone is connected and enabled.';
        handleTranscriptionError(errorMessage);
      } else if (err.name === 'AbortError') {
        errorMessage = 'Recording setup was aborted.'; // e.g. if another getUserMedia request interrupts
        handleTranscriptionError(errorMessage);
      } else {
        errorMessage = err.message;
        handleTranscriptionError(`Error during recording setup: ${errorMessage}`);
      }
    } else {
       handleTranscriptionError(`An unknown error occurred during recording setup: ${String(err)}`);
    }

    if (obtainedStream) {
      obtainedStream.getTracks().forEach((track) => track.stop());
    }
    if (audioStream && audioStream !== obtainedStream) { // If audioStream was assigned separately
        audioStream.getTracks().forEach((track) => track.stop());
    }
    audioStream = null;
    mediaRecorder = null;
    // recordingStatus is set to 'error' by handleTranscriptionError
    // Call cleanupAfterRecording to ensure consistent state reset on error
    await cleanupAfterRecording(true); // Treat as cancellation/error
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

    if (musicManaged) {
        const transcriptionSettings = await window.api.getStoreValue("transcription") as TranscriptionSettings || {};
        // Resume music if configured, or if it was a cancellation/error and music was playing
        if (transcriptionSettings.musicManagementResumeOnStop || isCancellationOrSilence) {
            window.api.log('info', 'Attempting to resume music playback after recording/cancellation.');
            await window.api.controlMusic('play'); // Or 'playpause'
        }
        musicManaged = false; // Reset for next recording session
    }
    // This notification might be to signal the main process that the renderer is now idle/ready.
    window.api.notifyRecorderStarted(); 
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
  window.api.log('error', 'Transcription error:', error);
  transcriptionError.set(error);
  if (get(recordingStatus) !== 'error') {
    recordingStatus.set('error');
    window.api.updateRecordingStatus('error'); // Inform main process
  }
  window.api.playSystemSound(SOUND_CANCEL);
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