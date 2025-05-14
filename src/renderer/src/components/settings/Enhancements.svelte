<script lang="ts">
  import { onMount } from "svelte";
  import { v4 as uuidv4 } from "uuid";
  import { writable, get, derived } from "svelte/store";
  import Multiselect from "svelte-multiselect";

  interface EnhancementSettings {
    enabled: boolean;
    provider: "openai" | "gemini" | "custom";
    openaiApiKey: string;
    openaiModel: "gpt-4.1" | "gpt-4.1-mini";
    openaiBaseUrl?: string;
    geminiApiKey: string;
    geminiModel:
      | "gemini-2.0-flash"
      | "gemini-2.5-flash"
      | "gemini-2.0-flash-lite";
    customApiKey: string;
    customModelName: string;
    customBaseUrl?: string;
    activePromptChain: string[];
    useTranscript: boolean;
    useContextScreen: boolean;
    useContextInputField: boolean;
    useContextClipboard: boolean;
    useDictionaryWordList: boolean;
  }

  interface EnhancementPrompt { // For user-created prompts
    id: string;
    name: string;
    template: string;
    temperature: number;
  }

  // Interface for the new system default prompts (fetched from backend)
  interface SystemPrompt {
    id: string; // e.g., "default_clean_transcription"
    name: string; // e.g., "Default Clean Transcription"
    template: string;
    temperature: number;
    isFallback?: boolean; // Optional: indicates if the template is a fallback
  }

  // Type for items in DND lists and modals
  type DisplayablePrompt = EnhancementPrompt | SystemPrompt;

  const DEFAULT_CLEAN_TRANSCRIPTION_ID = "default_clean_transcription";
  const DEFAULT_CONTEXTUAL_FORMATTING_ID = "default_contextual_formatting";
  const SYSTEM_DEFAULT_PROMPT_IDS = new Set([
    DEFAULT_CLEAN_TRANSCRIPTION_ID,
    DEFAULT_CONTEXTUAL_FORMATTING_ID,
  ]);

  const FALLBACK_CUSTOM_PROMPT_TEMPERATURE = 0.7; // For custom prompts if not set

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
  const prompts = writable<EnhancementPrompt[]>([]); // Stores only custom prompts
  const systemPromptDetailsCache = writable<Record<string, SystemPrompt>>({}); // Cache for default prompt details

  let newPromptName = "";
  let newPromptTemplate = "";
  let newPromptTemperature = FALLBACK_CUSTOM_PROMPT_TEMPERATURE;
  let showAddPrompt = false;
  let showPromptModal = false;
  let modalMode: "view" | "edit" | "add" = "add";
  let currentPrompt: DisplayablePrompt | null = null;
  let editPromptName = "";
  let editPromptTemplate = "";
  let editPromptTemperature = FALLBACK_CUSTOM_PROMPT_TEMPERATURE;

  // const dndOptions = { ... }; // Removed
  // let defaultPromptContent = ""; // Removed

  // Removed activeChainPrompts and availablePrompts derived stores

  // Create a new derived store for all prompts, suitable for Multiselect and general listing
  const allDisplayablePrompts = derived(
    [prompts, systemPromptDetailsCache],
    ([$customPrompts, $systemPromptsCache]) => {
      const systemDefaults = Array.from(SYSTEM_DEFAULT_PROMPT_IDS)
        .map(id => $systemPromptsCache[id])
        .filter(p => p) as SystemPrompt[];
      
      const allPrompts: DisplayablePrompt[] = [...systemDefaults, ...$customPrompts.map(p => ({
        ...p,
        temperature: p.temperature ?? FALLBACK_CUSTOM_PROMPT_TEMPERATURE
      }))];
      
      // Ensure unique prompts by ID, prioritizing system defaults if IDs were to clash (unlikely)
      const uniquePrompts = new Map<string, DisplayablePrompt>();
      allPrompts.forEach(p => {
        if (!uniquePrompts.has(p.id)) {
          uniquePrompts.set(p.id, p);
        }
      });
      return Array.from(uniquePrompts.values());
    }
  );
  
  // This will hold the prompt *objects* selected in the Multiselect
  // It needs to be initialized based on the IDs in $settings.activePromptChain
  let selectedPromptObjects: DisplayablePrompt[] = [];

  // Reactive statement to update selectedPromptObjects when $settings.activePromptChain or $allDisplayablePrompts changes
  $: {
    if ($settings && $allDisplayablePrompts) {
      const currentActiveChainIds = $settings.activePromptChain;
      selectedPromptObjects = currentActiveChainIds
        .map(id => $allDisplayablePrompts.find(p => p.id === id))
        .filter(p => p !== undefined) as DisplayablePrompt[];
    }
  }

  // Function to update $settings.activePromptChain when Multiselect changes
  // The event detail from svelte-multiselect usually gives the full selected objects
  const handleMultiselectChange = (event: CustomEvent<{items: DisplayablePrompt[]}>) => {
    const newSelectedPromptObjects = event.detail.items || [];
    settings.update(s => ({
      ...s,
      activePromptChain: newSelectedPromptObjects.map(p => p.id)
    }));
  };


  onMount(async () => {
    try {
      const storedSettingsPromise = window.api.getStoreValue("enhancements") as Promise<Partial<EnhancementSettings> | undefined>;
      const storedPromptsPromise = window.api.getStoreValue("enhancementPrompts") as Promise<Partial<EnhancementPrompt>[] | undefined>;
      
      const defaultPromptDetailPromises = Array.from(SYSTEM_DEFAULT_PROMPT_IDS).map(id =>
        window.api.getDefaultPromptDetails(id).catch(err => {
          window.api.log("error", `Failed to fetch details for default prompt ${id} on mount:`, err);
          return null; // Allow Promise.all to complete
        })
      );

      const [storedSettings, storedPromptsResult, ...fetchedDefaultDetails] =
        await Promise.all([
          storedSettingsPromise,
          storedPromptsPromise,
          ...defaultPromptDetailPromises
        ]);

      // Populate systemPromptDetailsCache
      fetchedDefaultDetails.forEach(details => {
        if (details) {
          systemPromptDetailsCache.update(cache => ({ ...cache, [details.id]: details as SystemPrompt }));
        }
      });

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


      if (storedPromptsResult) {
        const migratedPrompts = storedPromptsResult
          .filter((p) => p?.id && p.name && p.template) // Basic validation
          .map((p) => ({
            id: p!.id!,
            name: p!.name!,
            template: p!.template!,
            temperature: p?.temperature ?? FALLBACK_CUSTOM_PROMPT_TEMPERATURE,
          }));
        prompts.set(migratedPrompts as EnhancementPrompt[]); // Ensure it's EnhancementPrompt[]
      } else {
        prompts.set([]);
      }
    } catch (error) {
      window.api.log("error", "Failed to load enhancement settings:", error);
      prompts.set([]);
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

  const addPrompt = async () => {
    if (!newPromptName.trim() || !newPromptTemplate.trim()) {
      alert("Please provide both a name and a template for the new prompt.");
      return;
    }
    const newPrompt: EnhancementPrompt = {
      id: uuidv4(),
      name: newPromptName.trim(),
      template: newPromptTemplate.trim(),
      temperature: newPromptTemperature, // This is EnhancementPrompt
    };
    const currentPrompts = get(prompts);
    const updatedPrompts = [...currentPrompts, newPrompt];
    try {
      await window.api.setStoreValue("enhancementPrompts", updatedPrompts);
      prompts.set(updatedPrompts);
      newPromptName = "";
      newPromptTemplate = "";
      newPromptTemperature = FALLBACK_CUSTOM_PROMPT_TEMPERATURE;
      showAddPrompt = false;
      window.api.log("info", `Added new enhancement prompt: ${newPrompt.name}`);
    } catch (error) {
      window.api.log("error", "Failed to save new prompt:", error);
      alert("Failed to save the new prompt.");
    }
  };

  const deletePrompt = async (idToDelete: string) => {
    if (SYSTEM_DEFAULT_PROMPT_IDS.has(idToDelete)) {
      window.api.log("warn", `Attempted to delete system default prompt ID: ${idToDelete}. This is not allowed.`);
      return; // System defaults cannot be deleted
    }
    if (
      !confirm(
        "Are you sure you want to delete this prompt? This will also remove it from the active chain.",
      )
    )
      return;

    const currentPrompts = get(prompts);
    const updatedPrompts = currentPrompts.filter((p) => p.id !== idToDelete);
    const currentSettings = get(settings);
    const updatedChain = currentSettings.activePromptChain.filter(
      (id) => id !== idToDelete,
    );

    if (updatedChain.length === 0) {
      // Repopulate with both new defaults if chain becomes empty
      updatedChain.push(DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID);
    }

    try {
      await Promise.all([
        window.api.setStoreValue("enhancementPrompts", updatedPrompts),
        window.api.setStoreValue("enhancements", {
          ...currentSettings,
          activePromptChain: updatedChain,
        }),
      ]);

      prompts.set(updatedPrompts);
      settings.update((s) => ({ ...s, activePromptChain: updatedChain }));

      window.api.log(
        "info",
        `Deleted enhancement prompt ID: ${idToDelete} and updated chain.`,
      );
    } catch (error) {
      window.api.log("error", "Failed to delete prompt:", error);
      alert("Failed to delete the prompt.");
    }
  };

  const closeModal = () => {
    showPromptModal = false;
    currentPrompt = null;
    editPromptName = "";
    editPromptTemplate = "";
  };

  const openPromptModal = async (promptId: string) => {
    let foundPrompt: DisplayablePrompt | null = null;
    let effectiveMode: "view" | "edit" = "edit";

    if (SYSTEM_DEFAULT_PROMPT_IDS.has(promptId)) {
      const details = get(systemPromptDetailsCache)[promptId] || await window.api.getDefaultPromptDetails(promptId);
      if (details) {
        // Ensure details are in cache if fetched now
        if (!get(systemPromptDetailsCache)[promptId] && details) {
            systemPromptDetailsCache.update(cache => ({...cache, [promptId]: details as SystemPrompt}));
        }
        foundPrompt = details as SystemPrompt;
        effectiveMode = "view"; // System defaults are always view-only
      } else {
        window.api.log("error", `Default prompt details not found for ID: ${promptId}`);
        alert(`Details for default prompt "${promptId}" not available.`);
        return;
      }
    } else {
      // Custom prompt
      const customPrompt = get(prompts).find((p) => p.id === promptId);
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
      editPromptName = foundPrompt.name;
      editPromptTemplate = foundPrompt.template;
      editPromptTemperature = foundPrompt.temperature;
      showPromptModal = true;
    } else {
      window.api.log("error", `Prompt not found for ID: ${promptId}`);
    }
  };

  const saveEditedPrompt = async () => {
    if (!currentPrompt || SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id)) {
      // Should not happen if UI is correct, but as a safeguard
      window.api.log("warn", "Attempted to save a system default prompt or no current prompt.");
      return;
    }
    if (!editPromptName.trim() || !editPromptTemplate.trim()) {
      alert("Prompt name and template cannot be empty.");
      return;
    }

    // currentPrompt here is guaranteed to be an EnhancementPrompt (custom)
    const updatedPrompt: EnhancementPrompt = {
      id: currentPrompt.id, // Keep original ID
      name: editPromptName.trim(),
      template: editPromptTemplate.trim(),
      temperature: editPromptTemperature,
    };

    const currentCustomPrompts = get(prompts);
    const updatedCustomPrompts = currentCustomPrompts.map((p) =>
      p.id === updatedPrompt.id ? updatedPrompt : p,
    );

    try {
      await window.api.setStoreValue("enhancementPrompts", updatedCustomPrompts);
      prompts.set(updatedCustomPrompts);
      window.api.log("info", `Updated prompt: ${updatedPrompt.name}`);
      closeModal();
    } catch (error) {
      window.api.log("error", "Failed to save updated prompt:", error);
      alert("Failed to save the updated prompt.");
    }
  };

  // Removed handleChainSort and handleAddAvailableToSort functions
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

        <div class="divider pt-4">Enhancement Prompt Chain</div>
        <p class="text-sm opacity-70 -mt-4 mb-2">
          Select and order the prompts to run in sequence.
        </p>
        <div class="form-control">
          <Multiselect
            options={$allDisplayablePrompts.map(p => ({ value: p.id, label: p.name, original: p }))}
            bind:selected={selectedPromptObjects}
            on:change={handleMultiselectChange}
            placeholder="Select prompts for the chain..."
            multiple={true}
            sortSelected={false}
            closeOnSelect={false}
            clearOnSelect={false}
            idField="value"
            labelField="label"
            orderable={true}
          />
           {#if selectedPromptObjects.length === 0}
            <p class="text-xs text-warning-content mt-1">
              Warning: No prompts selected. Enhancement will use the default two-step chain.
            </p>
          {/if}
        </div>

        <div class="divider pt-6">Manage Prompts</div>
        <div class="space-y-2">
          {#each $allDisplayablePrompts as prompt (prompt.id)}
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
                on:click={() => openPromptModal(prompt.id)}
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
                  on:click={() => deletePrompt(prompt.id)}
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
        
        <div class="mt-6">
          {#if showAddPrompt}
            <div class="p-4 border border-base-300 rounded-md space-y-3">
              <h4 class="font-medium">Add New Prompt</h4>
              <div class="form-control">
                <label class="label py-1" for="new-prompt-name"
                  ><span class="label-text">Prompt Name:</span></label
                >
                <input
                  id="new-prompt-name"
                  type="text"
                  placeholder="e.g., Formal Report Style"
                  class="input input-bordered input-sm w-full"
                  bind:value={newPromptName}
                />
              </div>
              <div class="form-control">
                <label class="label py-1" for="new-prompt-template"
                  ><span class="label-text">Prompt Template:</span></label
                >
                <textarea
                  id="new-prompt-template"
                  class="textarea textarea-bordered w-full"
                  rows="4"
                  placeholder="Enter your prompt. Use {'{{transcription}}'} or output of previous prompt."
                  bind:value={newPromptTemplate}
                ></textarea>
                <span class="pt-2 block-inline text-sm"
                  >Use <a
                    target="_blank"
                    class="underline"
                    href="https://mustache.github.io/mustache.5.html"
                    >mustache templating</a
                  >. Variables:
                  <code class="kbd kbd-xs h-auto">{"{{transcription}}"}</code>
                  (for first prompt),
                  <code class="kbd kbd-xs h-auto">{"{{previous_output}}"}</code>
                  (for subsequent prompts),
                  <code class="kbd kbd-xs h-auto">{"{{dictionary_words}}"}</code
                  >,
                  <code class="kbd kbd-xs h-auto">{"{{context_screen}}"}</code>,
                  etc.</span
                >
              </div>
              <div class="form-control">
                <label class="label" for="new-prompt-temperature">
                  <span class="label-text">Temperature:</span>
                  <span class="label-text-alt"
                    >{newPromptTemperature.toFixed(1)}</span
                  >
                </label>
                <input
                  id="new-prompt-temperature"
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  bind:value={newPromptTemperature}
                  class="range range-primary range-sm"
                />
                <div class="w-full flex justify-between text-xs px-2 pt-1">
                  <span>Precise</span><span>Balanced</span><span>Creative</span>
                </div>
              </div>
              <div class="flex justify-end gap-2 pt-2">
                <button
                  class="btn btn-sm btn-ghost"
                  on:click={() => {
                    showAddPrompt = false;
                    newPromptName = "";
                    newPromptTemplate = "";
                    newPromptTemperature = FALLBACK_CUSTOM_PROMPT_TEMPERATURE;
                  }}>Cancel</button
                >
                <button class="btn btn-sm btn-primary" on:click={addPrompt}
                  >Add Prompt</button
                >
              </div>
            </div>
          {:else}
            <button
              class="btn btn-sm btn-outline"
              on:click={() => {
                showAddPrompt = true;
              }}
            >
              <i class="ri-add-line"></i> Add Custom Prompt
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showPromptModal && currentPrompt}
  <dialog id="prompt_modal" class="modal modal-open">
    <div class="modal-box w-11/12 max-w-2xl">
      <h3 class="font-bold text-lg mb-4">
        {#if modalMode === "view"}
          View Prompt: {currentPrompt.name}
        {:else if modalMode === "edit"}
          Edit Prompt: {currentPrompt.name}
        {/if}
      </h3>

      {#if modalMode === "view"}
        <div class="space-y-4">
          <div>
            <div class="label">
              <span class="label-text font-semibold">Name:</span>
            </div>
            <p class="p-2 bg-base-200 rounded">{currentPrompt.name}</p>
          </div>
          <div>
            <div class="label">
              <span class="label-text font-semibold">Template:</span>
            </div>
            <pre
              class="p-2 bg-base-200 rounded text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{currentPrompt.template}</pre>
          </div>
          <div>
            <div class="label">
              <span class="label-text font-semibold">Temperature:</span>
            </div>
            <p class="p-2 bg-base-200 rounded">
              {currentPrompt.temperature.toFixed(1)}
            </p>
          </div>
        </div>
      {:else if modalMode === "edit" && !SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id) }
        <!-- Edit mode only for non-system prompts -->
        <div class="space-y-4">
          <div class="form-control">
            <label class="label py-1" for="edit-prompt-name"
              ><span class="label-text">Prompt Name:</span></label
            >
            <input
              id="edit-prompt-name"
              type="text"
              class="input input-bordered w-full"
              bind:value={editPromptName}
            />
          </div>
          <div class="form-control">
            <label class="label py-1" for="edit-prompt-template"
              ><span class="label-text">Prompt Template:</span></label
            >
            <textarea
              id="edit-prompt-template"
              class="textarea textarea-bordered w-full"
              rows="6"
              placeholder="Use {'{{transcription}}'} or {'{{previous_output}}'}..."
              bind:value={editPromptTemplate}
            ></textarea>
            <span class="pt-2 block-inline text-sm"
              >Variables: <code class="kbd kbd-xs h-auto"
                >{"{{transcription}}"}</code
              >, <code class="kbd kbd-xs h-auto">{"{{previous_output}}"}</code>,
              context vars, etc.</span
            >
          </div>
          <div class="form-control">
            <label class="label" for="edit-prompt-temperature">
              <span class="label-text">Temperature:</span>
              <span class="label-text-alt"
                >{editPromptTemperature.toFixed(1)}</span
              >
            </label>
            <input
              id="edit-prompt-temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              bind:value={editPromptTemperature}
              class="range range-primary range-sm"
            />
            <div class="w-full flex justify-between text-xs px-2 pt-1">
              <span>Precise</span><span>Balanced</span><span>Creative</span>
            </div>
          </div>
        </div>
      {:else if modalMode === "edit" && SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id)}
         <!-- This case should ideally not be reached if openPromptModal sets mode to "view" for system defaults -->
        <p class="text-warning">
          System default prompts cannot be edited.
        </p>
      {/if}

      <div class="modal-action mt-6">
        <button class="btn btn-ghost" on:click={closeModal}>Close</button>
        {#if modalMode === "edit" && currentPrompt && !SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id)}
          <button class="btn btn-primary" on:click={saveEditedPrompt}
            >Save Changes</button
          >
        {/if}
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button on:click={closeModal}>close</button>
    </form>
  </dialog>
{/if}
