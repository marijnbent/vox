<script lang="ts">
  import { onMount } from "svelte";
  import { writable, get } from "svelte/store"; // Removed derived, uuidv4
  import Multiselect from "svelte-multiselect";
  import PromptModal from "./PromptModal.svelte";
  import type {
    EnhancementSettings,
    EnhancementPrompt as StoreEnhancementPrompt,
  } from "../../../../main/store";
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
    activePromptChain: [
      DEFAULT_CLEAN_TRANSCRIPTION_ID,
      DEFAULT_CONTEXTUAL_FORMATTING_ID,
    ],
    useTranscript: true,
    useContextScreen: false,
    useContextInputField: false,
    useContextClipboard: false,
    useDictionaryWordList: false,
  });

  let isLoading = true;

  let showPromptModal = false;
  let modalMode: "view" | "edit" | "add" = "add";
  let currentPrompt: DisplayablePrompt | null = null;

  interface MappedPromptOption {
    value: string; // Prompt ID
    label: string; // Prompt Name
    original: DisplayablePrompt; // The full prompt object
  }

  let selectedMappedOptions: MappedPromptOption[] = [];

  let multiselectComponentOptions: MappedPromptOption[] = [];
  $: multiselectComponentOptions = $allPrompts.map((p) => ({
    value: p.id,
    label: p.name,
    original: p,
  }));

  $: {
    if (
      $settings &&
      Array.isArray($settings.activePromptChain) &&
      multiselectComponentOptions.length > 0
    ) {
      const optionsMap = new Map(
        multiselectComponentOptions.map((opt) => [opt.value, opt]),
      );
      const newSelectedOptions: MappedPromptOption[] = [];

      for (const id of $settings.activePromptChain) {
        const mappedOption = optionsMap.get(id); // Get the option object by reference
        if (mappedOption) {
          newSelectedOptions.push(mappedOption);
        } else {
          window.api.log(
            "warn",
            `Prompt ID "${id}" in activePromptChain not found in multiselectComponentOptions.`,
          );
        }
      }

      // Only update if the selection has genuinely changed to avoid reactivity loops.
      if (
        selectedMappedOptions.length !== newSelectedOptions.length ||
        selectedMappedOptions.some(
          (opt, index) => opt.value !== newSelectedOptions[index]?.value,
        )
      ) {
        selectedMappedOptions = newSelectedOptions;
      }
    } else if (
      $settings &&
      $settings.activePromptChain &&
      $settings.activePromptChain.length === 0
    ) {
      // If activePromptChain is empty, ensure selectedMappedOptions is also empty.
      if (selectedMappedOptions.length !== 0) {
        selectedMappedOptions = [];
      }
    } else if (
      multiselectComponentOptions.length === 0 &&
      $settings?.activePromptChain?.length > 0
    ) {
      // If options are not loaded yet but there's an active chain, selection should be empty.
      if (selectedMappedOptions.length !== 0) {
        selectedMappedOptions = [];
      }
    }
  }

  // Function to update $settings.activePromptChain when Multiselect changes

  // Define event detail types for clarity, matching svelte-multiselect documentation
  interface MultiselectChangeEventDetailAdd {
    type: "add";
    option: MappedPromptOption;
  }
  interface MultiselectChangeEventDetailRemove {
    type: "remove";
    option: MappedPromptOption;
  }
  interface MultiselectChangeEventDetailRemoveAll {
    type: "removeAll";
    options: MappedPromptOption[]; // These are the options that *were* selected
  }

  type MultiselectChangeEventDetail =
    | MultiselectChangeEventDetailAdd
    | MultiselectChangeEventDetailRemove
    | MultiselectChangeEventDetailRemoveAll;

  const handleMultiselectChange = (
    event: CustomEvent<MultiselectChangeEventDetail>,
  ) => {
    const detail = event.detail;
    const currentChain = get(settings).activePromptChain;
    let newActiveChainIds: string[];

    if (detail.type === "add") {
      // Add the new prompt's ID if it's not already in the chain.
      // svelte-multiselect handles the visual addition; we update our source of truth.
      // It typically appends, so we replicate that.
      if (!currentChain.includes(detail.option.value)) {
        newActiveChainIds = [...currentChain, detail.option.value];
      } else {
        // If the prompt is already in the chain, and component somehow allowed adding again,
        // we keep the chain as is to avoid duplicate IDs in our store.
        newActiveChainIds = [...currentChain];
        window.api.log(
          "debug",
          `Prompt "${detail.option.label}" already in chain during 'add' event.`,
        );
      }
    } else if (detail.type === "remove") {
      newActiveChainIds = currentChain.filter(
        (id) => id !== detail.option.value,
      );
    } else if (detail.type === "removeAll") {
      newActiveChainIds = [];
    } else {
      // This case should ideally not be reached if event types are constrained.
      window.api.log(
        "error",
        `Unknown multiselect change event detail: ${JSON.stringify(detail)}`,
      );
      return; // Do not update if the event is not understood.
    }

    // Only update the store if the chain has actually changed to prevent unnecessary reactivity.
    if (JSON.stringify(currentChain) !== JSON.stringify(newActiveChainIds)) {
      settings.update((s) => ({
        ...s,
        activePromptChain: newActiveChainIds,
      }));
    }
    // The reactive block `$: { ... }` (lines 69-101) will derive selectedMappedOptions
    // from the updated $settings.activePromptChain, which then updates the `selected` prop of the Multiselect.
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
          temperature:
            customPrompt.temperature ?? FALLBACK_CUSTOM_PROMPT_TEMPERATURE,
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

  async function handlePromptModalSave(
    e: CustomEvent<{ name: string; template: string; temperature: number }>,
  ) {
    const { name, template, temperature } = e.detail;
    try {
      if (modalMode === "add") {
        await addPromptFromManager(name, template, temperature);
        showPromptModal = false;
      } else if (
        modalMode === "edit" &&
        currentPrompt &&
        !SYSTEM_DEFAULT_PROMPT_IDS.has(currentPrompt.id)
      ) {
        await editPromptFromManager(
          currentPrompt.id,
          name,
          template,
          temperature,
        );
        showPromptModal = false;
      }
    } catch (error) {
      // Error is already logged and alerted by the manager
      window.api.log(
        "debug",
        "Prompt save/edit failed at component level, handled by manager.",
      );
    }
  }

  onMount(async () => {
    isLoading = true;
    try {
      const storedSettingsPromise = window.api.getStoreValue(
        "enhancements",
      ) as Promise<Partial<EnhancementSettings> | undefined>;

      await initializePrompts(settings);
      const storedSettings = await storedSettingsPromise;

      if (storedSettings) {
        settings.update((currentDefaults) => {
          let chain = storedSettings.activePromptChain;
          const isOldDefault =
            Array.isArray(chain) &&
            chain.length === 1 &&
            chain[0] === "default";

          if (!Array.isArray(chain) || chain.length === 0 || isOldDefault) {
            chain = [
              DEFAULT_CLEAN_TRANSCRIPTION_ID,
              DEFAULT_CONTEXTUAL_FORMATTING_ID,
            ];
            window.api.log(
              "info",
              "Migrating activePromptChain to new two-item default.",
            );
          }
          return {
            ...currentDefaults,
            ...storedSettings,
            activePromptChain: chain,
          };
        });
      } else {
        settings.update((s) => ({
          ...s,
          activePromptChain: [
            DEFAULT_CLEAN_TRANSCRIPTION_ID,
            DEFAULT_CONTEXTUAL_FORMATTING_ID,
          ],
        }));
      }
    } catch (error) {
      window.api.log(
        "error",
        "Failed to load enhancement settings or prompts:",
        error,
      );
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
      window.api.log(
        "warn",
        `Attempted to delete system default prompt ID: ${idToDelete}. This is not allowed.`,
      );
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
      window.api.log(
        "debug",
        "Prompt deletion failed at component level, handled by manager.",
      );
    }
  };
</script>

<div class="p-4 space-y-6">
  <h2 class="text-xl font-semibold">Enhancement Settings</h2>

  {#if isLoading}
    <p>Loading settings...</p>
  {:else}
    <div class="bg-base-100 max-w-2xl space-y-6">
      <div class="form-control">
        <label class="label cursor-pointer" for="enable-enhancements-toggle">
          <span class="label-text font-semibold">Enable Enhancements</span>
          <input
            type="checkbox"
            id="enable-enhancements-toggle"
            class="toggle toggle-primary"
            bind:checked={$settings.enabled}
          />
        </label>
        <p class="text-sm opacity-70 ml-1">
          When enabled, transcriptions can be processed by an LLM to improve
          formatting, fix grammar, etc.
        </p>
      </div>

      {#if $settings.enabled}
        <div class="divider pt-4">Enhancement Provider</div>

        <div class="flex flex-wrap gap-4 items-center">
          <div class="form-control">
            <label class="label cursor-pointer gap-2">
              <input
                type="radio"
                name="enhancement-provider"
                class="radio radio-sm"
                value="openai"
                bind:group={$settings.provider}
              />
              <span class="label-text">OpenAI</span>
            </label>
          </div>
          <div class="form-control">
            <label class="label cursor-pointer gap-2">
              <input
                type="radio"
                name="enhancement-provider"
                class="radio radio-sm"
                value="gemini"
                bind:group={$settings.provider}
              />
              <span class="label-text">Gemini</span>
            </label>
          </div>
          <div class="form-control">
            <label class="label cursor-pointer gap-2">
              <input
                type="radio"
                name="enhancement-provider"
                class="radio radio-sm"
                value="custom"
                bind:group={$settings.provider}
              />
              <span class="label-text">Custom</span>
            </label>
          </div>
        </div>

        {#if $settings.provider === "openai"}
          <div class="mt-4 p-4 border border-base-300 rounded-md space-y-4">
            <h3 class="font-medium">OpenAI Configuration</h3>
            <div class="form-control">
              <label class="label" for="openai-enh-api-key">
                <span class="label-text">OpenAI API Key*</span>
              </label>
              <input
                id="openai-enh-api-key"
                type="password"
                placeholder="sk-..."
                class="input input-bordered input-sm w-full"
                bind:value={$settings.openaiApiKey}
              />
            </div>
            <div class="form-control">
              <label class="label" for="openai-enh-model-select">
                <span class="label-text">OpenAI Model*</span>
              </label>
              <select
                id="openai-enh-model-select"
                class="select select-bordered select-sm w-full max-w-xs"
                bind:value={$settings.openaiModel}
              >
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="gpt-4.1">GPT-4.1</option>
              </select>
            </div>
          </div>
        {:else if $settings.provider === "gemini"}
          <div class="mt-4 p-4 border border-base-300 rounded-md space-y-4">
            <h3 class="font-medium">Gemini Configuration</h3>
            <div class="form-control">
              <label class="label" for="gemini-api-key">
                <span class="label-text">Gemini API Key*</span>
              </label>
              <input
                id="gemini-api-key"
                type="password"
                placeholder="AIza..."
                class="input input-bordered input-sm w-full"
                bind:value={$settings.geminiApiKey}
              />
            </div>
            <div class="form-control">
              <label class="label" for="gemini-model-select">
                <span class="label-text">Gemini Model*</span>
              </label>
              <select
                id="gemini-model-select"
                class="select select-bordered select-sm w-full max-w-xs"
                bind:value={$settings.geminiModel}
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="gemini-2.0-flash-lite"
                  >Gemini 2.0 Flash Lite</option
                >
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </div>
          </div>
        {:else if $settings.provider === "custom"}
          <div class="mt-4 p-4 border border-base-300 rounded-md space-y-4">
            <h3 class="font-medium">Custom Provider Configuration</h3>

            <div class="form-control">
              <label class="label" for="custom-base-url">
                <span class="label-text">Base URL</span>
              </label>
              <input
                id="custom-base-url"
                type="text"
                placeholder="eg. https://api.mistral.ai/v1/"
                class="input input-bordered input-sm w-full"
                bind:value={$settings.customBaseUrl}
              />
              <label class="label" for="custom-base-url"
                ><span class="label-text-alt text-xs"
                  >Must be OpenAI API compatible.</span
                ></label
              >
            </div>

            <div class="form-control">
              <label class="label" for="custom-model-name">
                <span class="label-text">Model Name</span>
              </label>
              <input
                id="custom-model-name"
                type="text"
                placeholder="e.g. mistral-small-latest"
                class="input input-bordered input-sm w-full"
                bind:value={$settings.customModelName}
              />
            </div>

            <div class="form-control">
              <label class="label" for="custom-api-key">
                <span class="label-text">API Key</span>
              </label>
              <input
                id="custom-api-key"
                type="password"
                placeholder="Enter API Key"
                class="input input-bordered input-sm w-full"
                bind:value={$settings.customApiKey}
              />
            </div>
          </div>
        {/if}

        <div class="divider py-4">Context Variables</div>
        <p class="text-sm opacity-70 -mt-4 mb-4">
          Enable context sources to include them in your prompts using
          placeholders like <code class="kbd kbd-xs"
            >{"{{context_screen}}"}</code
          >
          or <code class="kbd kbd-xs">{"{{context_input_field}}"}</code>. These
          are available to all prompts in the chain.
        </p>
        <div class="form-control mb-2">
          <label class="label cursor-pointer">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              bind:checked={$settings.useContextScreen}
            />
            <span class="label-text">Screen Content</span>
          </label>
        </div>
        <div class="form-control mb-2">
          <label class="label cursor-pointer">
            <input
              type="checkbox"
              class="toggle toggle-sm"
              bind:checked={$settings.useContextInputField}
            />
            <span class="label-text">Input Field</span>
          </label>
        </div>

        <div class="divider py-4">Enhancement Prompt Chain</div>
        <p class="text-sm opacity-70 -mt-4 mb-2">
          Select and order the prompts to run in sequence.
        </p>
        <div class="form-control">
          <Multiselect
            options={multiselectComponentOptions}
            selected={selectedMappedOptions}
            on:change={handleMultiselectChange}
            placeholder="Select prompts for the chain..."
          />
          {#if selectedMappedOptions.length === 0}
            <p class="text-xs text-warning-content mt-1">
              Warning: No prompts selected. Enhancement will use the default
              two-step chain.
            </p>
          {/if}
        </div>

        <div class="divider pt-6">Manage Prompts</div>
        <div class="flex justify-end mb-2">
          <button class="button cursor-pointer" on:click={() => openPromptModalWrapper()}>
            <i class="ri-add-line mr-1"></i> Add Prompt
          </button>
        </div>
        <div class="space-y-2">
          {#each $allPrompts as prompt (prompt.id)}
            <div
              class="p-2 bg-base-200 rounded shadow-sm flex items-center gap-2"
            >
              <span class="flex-1 truncate" title={prompt.name}>
                {prompt.name}
                {#if SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)}
                  <span class="badge badge-xs badge-outline ml-2">System</span>
                {/if}
              </span>
              <span class="text-xs opacity-60"
                >T: {prompt.temperature.toFixed(1)}</span
              >
              <button
                class="btn btn-xs btn-ghost"
                title={SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)
                  ? "View Prompt"
                  : "View/Edit Prompt"}
                aria-label={SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)
                  ? "View Prompt"
                  : "View/Edit Prompt"}
                on:click={() => openPromptModalWrapper(prompt.id)}
              >
                <i class="ri-eye-line"></i>
                {#if !SYSTEM_DEFAULT_PROMPT_IDS.has(prompt.id)}
                  <span class="sr-only">/</span><i class="ri-pencil-line ml-1"
                  ></i>
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
              No prompts defined. Add a custom prompt or ensure system defaults
              are loaded.
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
