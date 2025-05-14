<script lang="ts">
  import { onMount } from "svelte";
  import { v4 as uuidv4 } from "uuid";
  import { writable, get, derived } from "svelte/store";
  import Multiselect from "svelte-multiselect";
  import PromptModal from "./PromptModal.svelte";
  import type { EnhancementSettings, EnhancementPrompt as StoreEnhancementPrompt } from "../../../../main/store";

  // Interface for the new system default prompts (fetched from backend)
  interface SystemPrompt {
    id: string;
    name: string;
    template: string;
    temperature: number;
    isFallback?: boolean;
  }

  type DisplayablePrompt = StoreEnhancementPrompt | SystemPrompt;

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
  const prompts = writable<StoreEnhancementPrompt[]>([]); // Stores only custom prompts
  const systemPromptDetailsCache = writable<Record<string, SystemPrompt>>({}); // Cache for default prompt details

  let newPromptName = "";
  let newPromptTemplate = "";
  let newPromptTemperature = FALLBACK_CUSTOM_PROMPT_TEMPERATURE;
  let showAddPrompt = false;

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

  // Type for the objects used by Multiselect options and its selection
  interface MappedPromptOption {
    value: string; // Prompt ID
    label: string; // Prompt Name
    original: DisplayablePrompt; // The full prompt object
  }
  
  // This will hold the MappedPromptOption objects selected in the Multiselect
  let selectedMappedOptions: MappedPromptOption[] = [];

  // Reactive statement to update selectedMappedOptions when $settings.activePromptChain or $allDisplayablePrompts changes
  $: {
    if ($settings && $allDisplayablePrompts) {
      const currentActiveChainIds = $settings.activePromptChain;
      selectedMappedOptions = currentActiveChainIds
        .map(id => {
          const originalPrompt = $allDisplayablePrompts.find(p => p.id === id);
          if (originalPrompt) {
            return { value: originalPrompt.id, label: originalPrompt.name, original: originalPrompt };
          }
          return undefined;
        })
        .filter(p => p !== undefined) as MappedPromptOption[];
    }
  }

  // Function to update $settings.activePromptChain when Multiselect changes
  const handleMultiselectChange = (event: CustomEvent<{items: MappedPromptOption[]}>) => {
    const newSelectedMappedOptions = event.detail.items || [];
    settings.update(s => ({
      ...s,
      activePromptChain: newSelectedMappedOptions.map(p => p.value) // Use p.value which is the ID
    }));
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
      const details = get(systemPromptDetailsCache)[promptId];
      if (details) {
        foundPrompt = details as SystemPrompt;
        effectiveMode = "view";
      }
    } else {
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
      showPromptModal = true;
    }
  }

  function handlePromptModalClose() {
    showPromptModal = false;
    currentPrompt = null;
  }

  async function handlePromptModalSave(e: CustomEvent<{ name: string; template: string; temperature: number }>) {
    const { name, template, temperature } = e.detail;
    if (modalMode === "add") {
      // Add new prompt
      const newPrompt: StoreEnhancementPrompt = {
        id: uuidv4(),
        name: name.trim(),
        template: template.trim(),
        temperature,
      };
      const currentPrompts = get(prompts);
      const updatedPrompts = [...currentPrompts, newPrompt];
      try {
        await window.api.setStoreValue("enhancementPrompts", updatedPrompts);
        prompts.set(updatedPrompts);
        showPromptModal = false;
      } catch (error) {
        window.api.log("error", "Failed to save new prompt:", error);
        alert("Failed to save the new prompt.");
      }
    } else if (modalMode === "edit" && currentPrompt && !SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id)) {
      // Edit existing prompt
      const updatedPrompt: StoreEnhancementPrompt = {
        id: currentPrompt.id,
        name: name.trim(),
        template: template.trim(),
        temperature,
      };
      const currentCustomPrompts = get(prompts);
      const updatedCustomPrompts = currentCustomPrompts.map((p) =>
        p.id === updatedPrompt.id ? updatedPrompt : p,
      );
      try {
        await window.api.setStoreValue("enhancementPrompts", updatedCustomPrompts);
        prompts.set(updatedCustomPrompts);
        showPromptModal = false;
      } catch (error) {
        window.api.log("error", "Failed to save updated prompt:", error);
        alert("Failed to save the updated prompt.");
      }
    }
  }

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
        prompts.set(migratedPrompts as StoreEnhancementPrompt[]); // Ensure it's StoreEnhancementPrompt[]
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
    const newPrompt: StoreEnhancementPrompt = {
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
            bind:selected={selectedMappedOptions}
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
           {#if selectedMappedOptions.length === 0}
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
