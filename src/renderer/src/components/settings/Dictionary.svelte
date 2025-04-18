<script lang="ts">
  import { onMount, tick } from 'svelte'; // Add tick
  import { writable, get } from 'svelte/store'; // Import writable/get

  // Define the type locally or import from a shared types file if available
  interface DictionarySettings {
    words: string[];
  }

  // Use writable store for dictionary settings
  const dictionarySettings = writable<DictionarySettings>({ words: [] });

  // New word to be added
  let newWord = '';

  onMount(async () => {
    const storedSettings = await window.api.getStoreValue('dictionary') as DictionarySettings | undefined;
    if (storedSettings) {
      dictionarySettings.set({ ...storedSettings }); // Use set for writable store
    }
    // Mark loading as complete *after* initial load
    isLoading = false;
  });

  // Debounced save function
  let saveTimeout: NodeJS.Timeout | null = null;
  const saveSettings = (currentSettings: DictionarySettings) => {
      if (isLoading) return; // Prevent saving during initial load
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
          try {
              await window.api.setStoreValue('dictionary', currentSettings);
              window.api.log('info', 'Dictionary settings auto-saved.');
          } catch (error) {
              window.api.log('error', 'Failed to auto-save dictionary settings:', error);
          }
      }, 500); // Debounce 500ms
  };

  // Reactive statement to save when words array changes
  $: if ($dictionarySettings?.words) {
      // Check isLoading to prevent saving on initial mount
      if (!isLoading) {
          saveSettings($dictionarySettings);
      }
  }

  // Add a new word to dictionary
  const addWord = (): void => {
    if (newWord.trim() === '') return;

    // Check if word already exists using get() for current value
    if (!get(dictionarySettings).words.includes(newWord.trim())) {
      // Update the store using update()
      dictionarySettings.update(settings => ({
          ...settings,
          words: [...settings.words, newWord.trim()]
      }));
      newWord = '';
    }
  };

  // Remove a word from dictionary using update()
  const removeWord = (wordToRemove: string): void => {
    dictionarySettings.update(settings => ({
        ...settings,
        words: settings.words.filter(w => w !== wordToRemove)
    }));
  };

  // UI feedback
  // let saveSuccess = false; // Removed
  let isLoading = true; // Added loading flag
</script>

<div class="p-4">
  <h2 class="text-2xl font-bold mb-6">Custom Dictionary</h2>

  <div class="bg-base-100 max-w-xl">
      <p class="text-sm opacity-70 mb-4">
        Add custom words, technical terms, or names to improve transcription accuracy. This only works if you enable enhancements.
      </p>

      <div class="form-control">
        <div class="input-group">
          <input
            type="text"
            class="input input-bordered flex-1"
            placeholder="Enter a custom word..."
            bind:value={newWord}
            on:keypress={(e): void => { if (e.key === 'Enter') addWord(); }}
          />
          <button class="btn btn-primary" on:click={addWord}>
            Add Word
          </button>
        </div>
      </div>

      <div class="mt-6">
        <h4 class="font-semibold mb-2">Current Dictionary</h4>

        {#if $dictionarySettings.words.length === 0}
          <div class="bg-base-200 p-4 text-center rounded-lg">
            <p class="opacity-60">Your custom dictionary is empty</p>
            <p class="text-sm mt-1 opacity-50">Add words above to improve transcription accuracy</p>
          </div>
        {:else}
          <div class="flex flex-wrap gap-2">
            {#each $dictionarySettings.words as word}
              <div class="badge badge-lg flex gap-1 p-1 pl-3">
                <span>{word}</span>
                <button
                  class="btn btn-xs btn-ghost btn-circle"
                  aria-label={`Remove word ${word}`}
                  on:click={(): void => { removeWord(word); }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}

        {#if $dictionarySettings.words.length > 0}
          <button
            class="btn btn-xs btn-outline mt-4"
            on:click={() => dictionarySettings.update(s => ({ ...s, words: [] }))}
          >
            Clear All
          </button>
        {/if}
      </div>

      <div class="bg-base-200 rounded-md p-3 mt-6">
        <h4 class="font-semibold mb-1">How it works:</h4>
        <p class="text-sm opacity-80">
          Words added to your custom dictionary will be given higher priority during transcription.
          This is especially useful for technical terms, uncommon names, or domain-specific jargon
          that might otherwise be misinterpreted.
        </p>
      </div>

      <!-- Removed Save Success Alert -->

      <!-- Removed Save Button -->
    </div>
  </div>