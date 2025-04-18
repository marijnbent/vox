<script lang="ts">
  import { recordingStatus, transcriptionResult, transcriptionError } from '../../lib/audioRecorder';
  import { onDestroy } from 'svelte';

  let statusText = 'Ready';
  let iconClass = 'ri-mic-line'; // Default icon
  let indicatorClass = 'bg-base-content/20'; // Default background
  let showResultTimeout: NodeJS.Timeout | null = null;

  const statusUnsubscribe = recordingStatus.subscribe(status => {
    clearTimeoutIfActive();
    switch (status) {
      case 'recording':
        statusText = 'Recording';
        iconClass = 'ri-record-circle-fill text-error animate-pulse'; // Pulsing red circle
        indicatorClass = 'bg-error/20';
        break;
      case 'processing':
        statusText = 'Processing';
        iconClass = 'ri-loader-4-line animate-spin'; // Spinner
        indicatorClass = 'bg-info/20';
        break;
      case 'error':
        statusText = $transcriptionError || 'Error'; // Show specific error if available
        iconClass = 'ri-error-warning-fill text-error'; // Error icon
        indicatorClass = 'bg-error/20';
        // Keep error visible for a while
        showResultTimeout = setTimeout(() => {
            if ($recordingStatus === 'error') { // Only reset if still in error state
                 recordingStatus.set('idle'); // Reset to idle after timeout
            }
        }, 5000);
        break;
      case 'idle':
      default:
        // Check if there's a recent result or error to display briefly
        if ($transcriptionResult) {
            statusText = 'Done';
            iconClass = 'ri-check-line text-success'; // Checkmark
            indicatorClass = 'bg-success/20';
            // Show result briefly then return to idle
            showResultTimeout = setTimeout(() => {
                 if ($recordingStatus === 'idle') { // Avoid race conditions
                    resetToIdle();
                 }
            }, 3000);
        } else {
             resetToIdle(); // Go directly to idle if no result/error
        }
        break;
    }
  });

  // Also watch transcriptionResult and transcriptionError directly
  // in case they update while status is already 'idle' (e.g., paste error)
  const resultUnsubscribe = transcriptionResult.subscribe(result => {
      if (result && $recordingStatus === 'idle') {
          clearTimeoutIfActive();
          statusText = 'Done';
          iconClass = 'ri-check-line text-success';
          indicatorClass = 'bg-success/20';
          showResultTimeout = setTimeout(resetToIdle, 3000);
      }
  });

  const errorUnsubscribe = transcriptionError.subscribe(error => {
      if (error && $recordingStatus !== 'error') { // Don't override if already in error state
          clearTimeoutIfActive();
          statusText = error;
          iconClass = 'ri-error-warning-fill text-error';
          indicatorClass = 'bg-error/20';
          showResultTimeout = setTimeout(() => {
              if ($recordingStatus !== 'recording' && $recordingStatus !== 'processing') {
                  recordingStatus.set('idle'); // Reset only if not actively recording/processing
              }
          }, 5000);
      }
  });


  function resetToIdle() {
      statusText = 'Ready';
      iconClass = 'ri-mic-line';
      indicatorClass = 'bg-base-content/20';
      // Clear results/errors from stores when truly idle? Optional.
      // transcriptionResult.set(null);
      // transcriptionError.set(null);
  }

  function clearTimeoutIfActive() {
      if (showResultTimeout) {
          clearTimeout(showResultTimeout);
          showResultTimeout = null;
      }
  }

  onDestroy(() => {
    statusUnsubscribe();
    resultUnsubscribe();
    errorUnsubscribe();
    clearTimeoutIfActive();
  });

</script>

<div class="px-4 py-2 mb-2 flex items-center space-x-2 rounded-md {indicatorClass}">
  <i class="{iconClass} text-lg"></i>
  <span class="text-sm font-medium truncate" title={$transcriptionError ?? statusText}>
    {statusText}
  </span>
</div>