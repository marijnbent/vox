<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  const availableKeys = [
    { id: 'Fn', label: 'Fn', mapped: 'FN' }, // FN key is often problematic for global monitoring
    { id: 'ControlLeft', label: 'Control', mapped: 'CONTROL' }, // Use generic CONTROL
    { id: 'AltLeft', label: 'Option (Alt)', mapped: 'OPTION' },   // Use generic OPTION
    { id: 'MetaLeft', label: 'Command', mapped: 'COMMAND' },    // Use generic COMMAND
  ];

  // --- Component State ---
  let selectedKeyIds: string[] = []; // UI state (using 'id')
  // let saveSuccess = false; // Removed
  let lastAction = { action: '', key: '', time: 0 };
  let isRecording = false; // Local copy of recording state from main process
  let isToggleMode = false; // Local copy of toggle mode state

  // --- API Communication ---
  let cleanupShortcutListener: (() => void) | null = null;
  let cleanupStateListener: (() => void) | null = null;

  // Function to get the mapped key names (COMMAND, OPTION, etc.) from selected IDs
  function getMappedKeys(): string[] {
      return selectedKeyIds
          .map(id => availableKeys.find(k => k.id === id)?.mapped)
          .filter((mapped): mapped is string => !!mapped);
  }

  onMount(async () => {
    window.api.log('info', 'Shortcuts component mounted.');

    // Load stored *mapped* keys
    const storedMappedKeys = await window.api.getStoreValue('shortcutKeysMapped') as string[] | undefined;
    if (storedMappedKeys && Array.isArray(storedMappedKeys)) {
      selectedKeyIds = availableKeys
          .filter(k => storedMappedKeys.includes(k.mapped))
          .map(k => k.id);
      window.api.log('debug', 'Loaded mapped keys from store:', storedMappedKeys);
    } else {
        // Fallback (optional)
        const legacyStoredKeys = await window.api.getStoreValue('shortcutKeys') as string[] | undefined;
         if (legacyStoredKeys && Array.isArray(legacyStoredKeys)) {
             selectedKeyIds = legacyStoredKeys.filter(keyId => availableKeys.some(k => k.id === keyId));
             window.api.log('debug', 'Loaded legacy key IDs from store:', selectedKeyIds);
         }
    }

    // Tell main process to start monitoring the initially loaded keys
    await window.api.updateMonitoredKeys(getMappedKeys());
    window.api.log('info', 'Initial monitored keys sent to main process:', getMappedKeys());

    // Listen for raw shortcut actions (for debugging/UI feedback)
    cleanupShortcutListener = window.api.onShortcutAction((action, keyName) => {
      window.api.log('debug', `Raw Shortcut Action Received: ${action}, Key: ${keyName}`);
      lastAction = { action, key: keyName, time: Date.now() };
      // We don't directly act on these anymore, state comes from recordingStateUpdate
    });

    // Listen for recording state updates from the main process
    cleanupStateListener = window.api.onRecordingStateUpdate((state) => {
        window.api.log('info', 'Recording state update received:', state);
        isRecording = state.isRecording;
        isToggleMode = state.isToggleMode;
    });

    // TODO: Optionally request initial state from main process if needed immediately
    // const initialState = await window.api.getRecordingState(); // Need to add getRecordingState to preload/main
    // if(initialState) {
    //     isRecording = initialState.isRecording;
    //     isToggleMode = initialState.isToggleMode;
    // }
  });

  onDestroy(() => {
    window.api.log('info', 'Shortcuts component destroying, cleaning up listeners.');
    if (cleanupShortcutListener) cleanupShortcutListener();
    if (cleanupStateListener) cleanupStateListener();
    // Consider if main process should stop monitoring here or on app quit
  });

  // Debounce function for saving/updating keys
  let saveTimeout: NodeJS.Timeout | null = null;
  const updateKeys = (keys: string[]) => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
          const mappedKeysToSave = getMappedKeys(); // Recalculate mapped keys based on current selection
          window.api.log('info', 'Auto-saving shortcut keys:', mappedKeysToSave);
          try {
              await window.api.setStoreValue('shortcutKeysMapped', mappedKeysToSave);
              await window.api.updateMonitoredKeys(mappedKeysToSave);
              window.api.log('info', 'Shortcut keys auto-saved and monitoring updated.');
          } catch (error) {
               window.api.log('error', 'Failed to auto-save shortcut keys:', error);
          }
      }, 500); // Debounce 500ms
  };

  // Reactive statement to trigger update when selection changes
  $: if (selectedKeyIds) {
      // Need to ensure this runs *after* initial load from store in onMount
      // A simple check or a dedicated 'isLoaded' flag could work, but
      // debouncing might be sufficient if onMount finishes quickly.
      // Let's rely on debouncing for now.
      updateKeys(selectedKeyIds);
  }

</script>

<div class="p-4">
  <h2 class="text-2xl font-bold mb-6">Keyboard Shortcuts</h2>

  <div class="bg-base-100 max-w-xl">
      <p class="text-sm opacity-70 mb-4">
        Select modifier keys to control recording.
      </p>
      <ul class="text-sm opacity-70 mb-4 list-disc pl-5">
        <li><strong>Hold:</strong> Record while key is held down.</li>
        <li><strong>Double Click:</strong> Toggle recording on/off.</li>
        <li>Clicks get dismissed.</li>
      </ul>

      <div class="form-control space-y-2 flex flex-col">
        {#each availableKeys as key}
          <label class="label cursor-pointer justify-start gap-4">
            <input
              type="checkbox"
              bind:group={selectedKeyIds}
              value={key.id}
              class="checkbox checkbox-primary"
            />
            <span class="label-text">{key.label}</span>
          </label>
        {/each}
      </div>

      <!-- Removed Save Success Alert -->

      <!-- Optional: Display last raw action for debugging -->
       {#if lastAction.time > 0}
         <p class="text-xs opacity-50 mt-4">Last Raw Action: {lastAction.action} on {lastAction.key} at {new Date(lastAction.time).toLocaleTimeString()}</p>
       {/if}

    </div>
</div>