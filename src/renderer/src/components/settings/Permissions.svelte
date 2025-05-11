<script lang="ts">
  import { onMount } from 'svelte';

  // Include 'not-determined' and 'unknown' as possible statuses from the API
  type PermissionStatus = 'checking' | 'granted' | 'not-granted' | 'unavailable' | 'denied' | 'restricted' | 'unknown' | 'not-determined';

  // Reactive state for permissions
  let accessibilityStatus: PermissionStatus = 'checking';
  let microphoneStatus: PermissionStatus = 'checking';
  let screenRecordingStatus: PermissionStatus = 'checking';
  let showManualInstructions = false; // State to show instructions after prompt

  // --- Accessibility ---
  async function checkAccessibilityStatus(): Promise<void> {
    window.api.log('debug', 'Checking Accessibility status...');
    accessibilityStatus = 'checking';
    showManualInstructions = false;
    try {
        const status = await window.api.getAccessibilityStatus();
        accessibilityStatus = status;
        window.api.log('info', 'Accessibility status:', status);
    } catch (error) {
        window.api.log('error', 'Error checking accessibility status:', error);
        accessibilityStatus = 'unavailable';
    }
  }

  async function requestAccessibility(): Promise<void> {
    window.api.log('info', 'Requesting Accessibility access (will prompt user)...');
    showManualInstructions = false;
    try {
        await window.api.requestAccessibilityAccess();
        window.api.log('info', 'Accessibility prompt shown. User needs to grant access in System Settings.');
        showManualInstructions = true;
        setTimeout(checkAccessibilityStatus, 5000);
    } catch (error) {
        window.api.log('error', 'Error requesting accessibility access:', error);
    }
  }

  // --- Media Permissions ---
  async function checkMediaStatus(mediaType: 'microphone' | 'screen'): Promise<void> {
      window.api.log('debug', `Checking ${mediaType} status...`);
      if (mediaType === 'microphone') microphoneStatus = 'checking';
      if (mediaType === 'screen') screenRecordingStatus = 'checking';

      try {
          // Ensure the status received from API matches our defined type
          const status = await window.api.getMediaPermissionStatus(mediaType) as PermissionStatus;
          if (mediaType === 'microphone') microphoneStatus = status;
          if (mediaType === 'screen') screenRecordingStatus = status;
          window.api.log('info', `${mediaType} status:`, status);
      } catch (error) {
          window.api.log('error', `Error checking ${mediaType} status:`, error);
          if (mediaType === 'microphone') microphoneStatus = 'unavailable';
          if (mediaType === 'screen') screenRecordingStatus = 'unavailable';
      }
  }

  async function requestMicrophone(): Promise<void> {
      window.api.log('info', 'Requesting Microphone access...');
      try {
          const granted = await window.api.requestMediaPermission('microphone');
          window.api.log('info', `Microphone access request result: ${granted}`);
          setTimeout(() => checkMediaStatus('microphone'), 1000);
          if (!granted) {
              window.api.log('warn', 'Microphone access denied or failed. Guide user to System Settings.');
          }
      } catch (error) {
          window.api.log('error', 'Error requesting microphone access:', error);
      }
  }

  function openScreenRecordingSettings(): void {
      window.api.log('info', 'Opening Screen Recording privacy settings via IPC...');
      // Use IPC to ask main process to open the URL
      window.api.openSettingsURL('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      setTimeout(() => checkMediaStatus('screen'), 5000);
  }

  // --- Lifecycle ---
  onMount(() => {
    if (navigator.platform.toUpperCase().indexOf('MAC') >= 0) {
        checkAccessibilityStatus();
        checkMediaStatus('microphone');
        checkMediaStatus('screen');
    } else {
        accessibilityStatus = 'unavailable';
        microphoneStatus = 'unavailable';
        screenRecordingStatus = 'unavailable';
    }
  });

  // Helper to get badge class
  function getBadgeClass(status: PermissionStatus): string {
      switch (status) {
          case 'granted': return 'badge-success';
          case 'denied':
          case 'restricted':
          case 'not-granted': return 'badge-error';
          case 'checking': return 'badge-ghost';
          default: return 'badge-ghost';
      }
  }

  // Helper to get status text
   function getStatusText(status: PermissionStatus): string {
      switch (status) {
          case 'granted': return 'Granted';
          case 'denied': return 'Denied';
          case 'restricted': return 'Restricted';
          case 'not-granted': return 'Not Granted';
          case 'checking': return 'Checking...';
          case 'not-determined': return 'Not Set';
          case 'unknown': return 'Unknown';
          default: return 'N/A';
      }
  }

</script>

<div class="p-4">
  <h2 class="text-2xl font-bold mb-6">Permissions</h2>

  <div class="bg-base-100 max-w-xl">
      <p class="text-sm opacity-70 mb-4">
        Vox Transcriber needs the following permissions to function properly.
      </p>

      <div class="space-y-6">
        <div class="flex items-start gap-4">
          <div class="bg-base-200 p-3 rounded-full mt-1">
            <span class="text-xl font-bold">⌨️</span>
          </div>
          <div class="flex-1">
            <h4 class="font-semibold">Accessibility Features</h4>
            <p class="text-sm opacity-70">Required for global keyboard shortcuts.</p>
            <div class="flex items-center gap-2 mt-1">
              <span class="badge {getBadgeClass(accessibilityStatus)} gap-1">
                 {#if accessibilityStatus !== 'checking' && accessibilityStatus !== 'unavailable'}
                    <span class="bg-white rounded-full w-2 h-2"></span>
                 {/if}
                 {getStatusText(accessibilityStatus)}
              </span>
            </div>
             {#if ['not-granted', 'not-determined', 'denied', 'restricted'].includes(accessibilityStatus)}
                <div class="mt-2">
                    {#if (accessibilityStatus === 'denied' || accessibilityStatus === 'restricted') && !showManualInstructions}
                        <p class="text-xs opacity-80 mb-2">
                            Accessibility access was previously {getStatusText(accessibilityStatus).toLowerCase()}. Clicking below will attempt to re-prompt and then show guidance for System Settings.
                        </p>
                    {/if}
                    <button class="btn btn-primary btn-sm" on:click={requestAccessibility}>
                      Request Access
                    </button>
                    {#if showManualInstructions}
                        <p class="text-xs text-warning mt-2">
                            The system prompt for Accessibility access may have appeared. If not, or if access is still not granted, please go to System Settings > Privacy & Security > Accessibility. Find 'Vox Transcriber' (or 'key-monitor') in the list, add it if missing, and ensure its toggle is ON. You might need to restart the app after changing this setting.
                        </p>
                    {/if}
                </div>
             {/if}
          </div>
           {#if accessibilityStatus === 'granted'}
             <span class="text-sm text-success mt-1">✓</span>
           {:else if accessibilityStatus === 'checking'}
             <span class="loading loading-spinner loading-xs mt-1"></span>
           {/if}
        </div>

        <!-- Microphone Permission -->
        <div class="flex items-start gap-4">
          <div class="bg-base-200 p-3 rounded-full mt-1">
            <span class="text-xl">🎤</span>
          </div>
          <div class="flex-1">
            <h4 class="font-semibold">Microphone Access</h4>
            <p class="text-sm opacity-70">Required to capture audio for transcription.</p>
             <div class="flex items-center gap-2 mt-1">
              <span class="badge {getBadgeClass(microphoneStatus)} gap-1">
                 {#if microphoneStatus !== 'checking' && microphoneStatus !== 'unavailable'}
                    <span class="bg-white rounded-full w-2 h-2"></span>
                 {/if}
                 {getStatusText(microphoneStatus)}
              </span>
               {#if microphoneStatus === 'denied' || microphoneStatus === 'restricted'}
                  <p class="text-xs text-error">Please grant access in System Settings.</p>
               {/if}
            </div>
             {#if microphoneStatus === 'not-determined' || microphoneStatus === 'denied' || microphoneStatus === 'restricted'}
                <div class="mt-2">
                    <button class="btn btn-primary btn-sm" on:click={requestMicrophone}>
                      Request Access
                    </button>
                </div>
             {/if}
          </div>
           {#if microphoneStatus === 'granted'}
             <span class="text-sm text-success mt-1">✓</span>
           {:else if microphoneStatus === 'checking'}
             <span class="loading loading-spinner loading-xs mt-1"></span>
           {/if}
        </div>

        <!-- Screen Recording Permission -->
         <div class="flex items-start gap-4">
          <div class="bg-base-200 p-3 rounded-full mt-1">
            <span class="text-xl">🖥️</span>
          </div>
          <div class="flex-1">
            <h4 class="font-semibold">Screen Recording (macOS)</h4>
            <p class="text-sm opacity-70">Optional - For future contextual features.</p>
             <div class="flex items-center gap-2 mt-1">
              <span class="badge {getBadgeClass(screenRecordingStatus)} gap-1">
                 {#if screenRecordingStatus !== 'checking' && screenRecordingStatus !== 'unavailable'}
                    <span class="bg-white rounded-full w-2 h-2"></span>
                 {/if}
                 {getStatusText(screenRecordingStatus)}
              </span>
               {#if screenRecordingStatus === 'denied' || screenRecordingStatus === 'restricted' || screenRecordingStatus === 'not-granted'}
                  <p class="text-xs text-error">Please grant access in System Settings.</p>
               {/if}
               {#if screenRecordingStatus === 'unavailable'}
                 <p class="text-xs opacity-50">(macOS only feature)</p>
               {/if}
            </div>
             {#if screenRecordingStatus !== 'granted' && screenRecordingStatus !== 'checking' && screenRecordingStatus !== 'unavailable'}
                <div class="mt-2">
                    <button class="btn btn-primary btn-sm" on:click={openScreenRecordingSettings}>
                      Open Settings
                    </button>
                </div>
             {/if}
          </div>
           {#if screenRecordingStatus === 'granted'}
             <span class="text-sm text-success mt-1">✓</span>
           {:else if screenRecordingStatus === 'checking'}
             <span class="loading loading-spinner loading-xs mt-1"></span>
           {/if}
        </div>

      </div>

      <div class="bg-base-200 p-4 rounded-md mt-6">
        <h4 class="font-semibold mb-1">Why do we need these permissions?</h4>
        <p class="text-sm opacity-80">
          Accessibility features on macOS are required for global keyboard shortcuts. Microphone access is needed for audio capture. Screen recording is optional for potential future features.
        </p>
        <p class="text-sm opacity-80 mt-2">
          All processing is done locally on your device.
        </p>
      </div>
  </div>
</div>