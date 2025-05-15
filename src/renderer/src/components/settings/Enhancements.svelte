<script lang="ts">
  import { onMount } from "svelte";
  import { writable, get } from "svelte/store"; // Removed derived, uuidv4
  import Multiselect from "svelte-multiselect";
  import PromptModal from "./PromptModal.svelte";
  import type { EnhancementSettings, EnhancementPrompt as StoreEnhancementPrompt } from "../../../../main/store";
  import {
    customPrompts,
    systemPromptCache,
    allPrompts,
    initializePrompts,
    addPrompt as addPromptFromManager,
    editPrompt as editPromptFromManager,
    deletePrompt as deletePromptFromManager,
    DEFAULT_CLEAN_TRANSCRIPTION_ID,
    DEFAULT_CONTEXTUAL_FORMATTING_ID,
    SYSTEM_DEFAULT_PROMPT_IDS,
    FALLBACK_CUSTOM_PROMPT_TEMPERATURE,
    type DisplayablePrompt,
    type SystemPrompt,
  } from "../../lib/promptManager";

  const settings = writable<EnhancementSettings>({
    enabled: false,
    provider: "openai",
    openaiApiKey: "",
    openaiModel: "gpt-4.1-mini",
    openaiBaseUrl: "",
    geminiApiKey: "",
    geminiModel: "gemini-2.0-flash",
    customApiKey: "",
    customModelName: "",
    customBaseUrl: "",
    activePromptChain: [DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID], // Updated default
    useTranscript: true,
    useContextScreen: false,
    useContextInputField: false,
    useContextClipboard: false,
    useDictionaryWordList: false,
  });

  let isLoading = true;
  // customPrompts and systemPromptCache are now imported from promptManager

  // State for the PromptModal
  let showPromptModal = false;
  let modalMode: "view" | "edit" | "add" = "add";
  let currentPrompt: DisplayablePrompt | null = null;

  // allPrompts is now imported from promptManager

  // Type for the objects used by Multiselect options and its selection
  interface MappedPromptOption {
    value: string; // Prompt ID
    label: string; // Prompt Name
    original: DisplayablePrompt; // The full prompt object
  }
  
  // This will hold the MappedPromptOption objects selected in the Multiselect
  let selectedMappedOptions: MappedPromptOption[] = [];

  // Reactive statement to update selectedMappedOptions when $settings.activePromptChain or $allPrompts changes
  // This ensures that selectedMappedOptions always reflects the current state of the active chain
  // and the available prompts, maintaining the correct order for the Multiselect component.
  $: {
    if ($settings && $allPrompts && Array.isArray($settings.activePromptChain)) {
      const allPromptsMap = new Map($allPrompts.map(p => [p.id, p]));
      const newSelectedOptions: MappedPromptOption[] = [];

      for (const id of $settings.activePromptChain) {
        const originalPrompt = allPromptsMap.get(id);
        if (originalPrompt) {
          newSelectedOptions.push({
            value: originalPrompt.id,
            label: originalPrompt.name,
            original: originalPrompt,
          });
        } else {
          // This case should ideally not happen if data is consistent.
          // It means an ID in activePromptChain doesn't exist in allPrompts.
          // Consider logging this or handling it, e.g., by filtering out such IDs from activePromptChain.
          window.api.log("warn", `Prompt ID "${id}" in activePromptChain not found in allPrompts.`);
        }
      }

      // Only update if the actual selection has changed to prevent infinite loops or unnecessary updates.
      // This compares the IDs in order.
      if (
        selectedMappedOptions.length !== newSelectedOptions.length ||
        selectedMappedOptions.some((opt, index) => opt.value !== newSelectedOptions[index]?.value)
      ) {
        selectedMappedOptions = newSelectedOptions;
      }
    } else if ($settings && $settings.activePromptChain && $settings.activePromptChain.length === 0) {
      // If the active chain is explicitly empty, clear the selection.
      if (selectedMappedOptions.length !== 0) {
        selectedMappedOptions = [];
      }
    }
    // If $allPrompts is not yet loaded, selectedMappedOptions will remain as is (likely empty initially),
    // and will be correctly populated once $allPrompts is available.
  }

  // Function to update $settings.activePromptChain when Multiselect changes
  const handleMultiselectChange = (event: CustomEvent<{items: MappedPromptOption[]}>) => {
    // The `event.detail.items` from svelte-multiselect contains the current selection
    // in the order they appear in the component.
    const newActiveChain = (event.detail.items || []).map(p => p.value);
    settings.update(s => ({
      ...s,
      activePromptChain: newActiveChain
    }));
    // `selectedMappedOptions` is updated by the `bind:selected` directive.
    // The reactive block `$: { ... }` will then ensure consistency if $allPrompts changes.
  };

  // Helper to open modal for view/edit/add
  function openPromptModalWrapper(promptId?: string) {
    if (!promptId) {
      modalMode = "add";
      currentPrompt = null;
      showPromptModal = true;
      return;
    }
    let foundPrompt: DisplayablePrompt | null = null;
    let effectiveMode: "view" | "edit" = "edit";
    if (SYSTEM_DEFAULT_PROMPT_IDS.has(promptId)) {
      const details = get(systemPromptCache)[promptId];
      if (details) {
        foundPrompt = details as SystemPrompt;
        effectiveMode = "view";
      }
    } else {
      const customPrompt = get(customPrompts).find((p) => p.id === promptId);
      if (customPrompt) {
        foundPrompt = {
          ...customPrompt,
          temperature: customPrompt.temperature ?? FALLBACK_CUSTOM_PROMPT_TEMPERATURE,
        };
        effectiveMode = "edit";
      }
    }
    if (foundPrompt) {
      currentPrompt = foundPrompt;
      modalMode = effectiveMode;
      showPromptModal = true;
    }
  }

  function handlePromptModalClose() {
    showPromptModal = false;
    currentPrompt = null;
  }

  async function handlePromptModalSave(e: CustomEvent<{ name: string; template: string; temperature: number }>) {
    const { name, template, temperature } = e.detail;
    try {
      if (modalMode === "add") {
        await addPromptFromManager(name, template, temperature);
        showPromptModal = false;
      } else if (modalMode === "edit" && currentPrompt && !SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id)) {
        await editPromptFromManager(currentPrompt.id, name, template, temperature);
        showPromptModal = false;
      }
    } catch (error) {
      // Error is already logged and alerted by the manager
      window.api.log("debug", "Prompt save/edit failed at component level, handled by manager.");
    }
  }

  onMount(async () => {
    isLoading = true;
    try {
      const storedSettingsPromise = window.api.getStoreValue("enhancements") as Promise<Partial<EnhancementSettings> | undefined>;
      
      // Initialize prompts using the manager
      await initializePrompts(settings); // Pass settings store if needed by manager, or remove if not

      const storedSettings = await storedSettingsPromise;

      if (storedSettings) {
        settings.update((currentDefaults) => {
          let chain = storedSettings.activePromptChain;
          const isOldDefault = Array.isArray(chain) && chain.length === 1 && chain[0] === "default";
          const isPartialNewDefault = Array.isArray(chain) && chain.length === 1 &&
                                    (chain[0] === DEFAULT_CLEAN_TRANSCRIPTION_ID || chain[0] === DEFAULT_CONTEXTUAL_FORMATTING_ID);

          if (!Array.isArray(chain) || chain.length === 0 || isOldDefault || isPartialNewDefault) {
            chain = [DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID];
            window.api.log("info", "Migrating activePromptChain to new two-item default.");
          }
          return {
            ...currentDefaults,
            ...storedSettings,
            activePromptChain: chain,
          };
        });
      } else {
         // Ensure default chain is set if no settings are stored
        settings.update(s => ({...s, activePromptChain: [DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID]}));
      }

      // Prompt loading is handled by initializePrompts
    } catch (error) {
      window.api.log("error", "Failed to load enhancement settings or prompts:", error);
      // customPrompts.set([]); // Managed by promptManager
    } finally {
      isLoading = false;
    }
  });

  $: if (!isLoading && $settings) {
    saveSettings($settings);
  }

  let saveTimeout: NodeJS.Timeout | null = null;
  const saveSettings = (currentSettings: EnhancementSettings) => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        await window.api.setStoreValue("enhancements", currentSettings);
        window.api.log("info", "Enhancement settings auto-saved.");
      } catch (error) {
        window.api.log(
          "error",
          "Failed to auto-save enhancement settings:",
          error,
        );
      }
    }, 500);
  };

  const handleDeletePrompt = async (idToDelete: string) => {
    if (SYSTEM_DEFAULT_PROMPT_IDS.has(idToDelete)) {
      window.api.log("warn", `Attempted to delete system default prompt ID: ${idToDelete}. This is not allowed.`);
      return;
    }
    if (
      !confirm(
        "Are you sure you want to delete this prompt? This will also remove it from the active chain.",
      )
    )
      return;

    try {
      await deletePromptFromManager(idToDelete, settings);
    } catch (error) {
      // Error is already logged and alerted by the manager
       window.api.log("debug", "Prompt deletion failed at component level, handled by manager.");
    }
  };
</script>

<div class="p-4 space-y-6">
  <h2 class="text-xl font-semibold">Enhancement Settings</h2>

  {#if isLoading}
    <p>Loading settings...</p>
  {:else}
    <div class="bg-base-100 max-w-2xl space-y-6">
      <!-- ... existing form controls ... -->

      {#if $settings.enabled}
        <!-- ... existing provider config ... -->

        <div class="divider py-4">Context Variables</div>
        <!-- ... existing context variables ... -->

        <div class="divider py-4">Enhancement Prompt Chain</div>
        <p class="text-sm opacity-70 -mt-4 mb-2">
          Select and order the prompts to run in sequence.
        </p>
        <div class="form-control">
          <Multiselect
            options={$allPrompts.map(p => ({ value: p.id, label: p.name, original: p }))}
            bind:selected={selectedMappedOptions}
            on:change={handleMultiselectChange}
            placeholder="Select prompts for the chain..."
            multiple={true}
            sortSelected={false}
            closeOnSelect={false}
            clearOnSelect={false}
            showClear={false}
            idField="value"
            labelField="label"
            orderable={true}
          />
           {#if selectedMappedOptions.length === 0}
            <p class="text-xs text-warning-content mt-1">
              Warning: No prompts selected. Enhancement will use the default two-step chain.
            </p>
          {/if}
        </div>

        <div class="divider pt-6">Manage Prompts</div>
        <div class="space-y-2">
          {#each $allPrompts as prompt (prompt.id)}
            <div class="p-2 bg-base-200 rounded shadow-sm flex items-center gap-2">
              <span class="flex-1 truncate" title={prompt.name}>
                {prompt.name}
                {#if SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)}
                  <span class="badge badge-xs badge-outline ml-2">System</span>
                {/if}
              </span>
              <span class="text-xs opacity-60">T: {prompt.temperature.toFixed(1)}</span>
              <button
                class="btn btn-xs btn-ghost"
                title={SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id) ? "View Prompt" : "View/Edit Prompt"}
                aria-label={SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id) ? "View Prompt" : "View/Edit Prompt"}
                on:click={() => openPromptModalWrapper(prompt.id)}
              >
                <i class="ri-eye-line"></i>
                {#if !SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)}
                  <span class="sr-only">/</span><i class="ri-pencil-line ml-1"></i>
                {/if}
              </button>
              {#if !SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)}
                <button
                  class="btn btn-xs btn-ghost text-error"
                  title="Delete Prompt Permanently"
                  aria-label="Delete Prompt Permanently"
                  on:click={() => handleDeletePrompt(prompt.id)}
                >
                  <i class="ri-delete-bin-line"></i>
                </button>
              {/if}
            </div>
          {:else}
            <p class="text-sm text-center opacity-60 py-4">
              No prompts defined. Add a custom prompt or ensure system defaults are loaded.
            </p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Prompt Modal for add/edit/view -->
<PromptModal
  show={showPromptModal}
  mode={modalMode}
  prompt={currentPrompt}
  systemDefaultIds={SYSTEM_DEFAULT_PROMPT_IDS}
  fallbackTemperature={FALLBACK_CUSTOM_PROMPT_TEMPERATURE}
  on:close={handlePromptModalClose}
  on:save={handlePromptModalSave}
/>
