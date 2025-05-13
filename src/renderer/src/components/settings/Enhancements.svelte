<script lang="ts">
  import { onMount } from "svelte";
  import { v4 as uuidv4 } from "uuid";
  import { writable, get, derived } from "svelte/store";
  import { dndzone } from "svelte-dnd-action";

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

  interface EnhancementPrompt {
    id: string;
    name: string;
    template: string;
    temperature: number;
  }

  interface DefaultPrompt {
    id: "default";
    name: string;
    template: string;
    temperature: number;
  }

  const DEFAULT_PROMPT_TEMPERATURE = 0.7;

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
    activePromptChain: ["default"],
    useTranscript: true,
    useContextScreen: false,
    useContextInputField: false,
    useContextClipboard: false,
    useDictionaryWordList: false,
  });

  let isLoading = true;
  const prompts = writable<EnhancementPrompt[]>([]);
  let newPromptName = "";
  let newPromptTemplate = "";
  let newPromptTemperature = DEFAULT_PROMPT_TEMPERATURE;
  let showAddPrompt = false;
  let showPromptModal = false;
  let modalMode: "view" | "edit" | "add" = "add";
  let currentPrompt: EnhancementPrompt | DefaultPrompt | null = null;
  let editPromptName = "";
  let editPromptTemplate = "";
  let editPromptTemperature = DEFAULT_PROMPT_TEMPERATURE;

  const dndOptions = {
    items: [] as (EnhancementPrompt | DefaultPrompt)[],
    flipDurationMs: 200,
  };
  let defaultPromptContent = "";

  const activeChainPrompts = derived(
    [settings, prompts],
    ([$settings, $prompts]) => {
      if (!$settings || !$prompts) return [];
      const getPromptDetails = (
        id: string,
      ): EnhancementPrompt | DefaultPrompt | null => {
        if (id === "default") {
          return {
            id: "default",
            name: "Default Prompt",
            template: defaultPromptContent,
            temperature: DEFAULT_PROMPT_TEMPERATURE,
          };
        }
        const prompt = $prompts.find((p) => p.id === id);
        return prompt
          ? {
              ...prompt,
              temperature: prompt.temperature ?? DEFAULT_PROMPT_TEMPERATURE,
            }
          : null;
      };
      return $settings.activePromptChain
        .map((id) => getPromptDetails(id))
        .filter((p): p is EnhancementPrompt | DefaultPrompt => p !== null);
    },
  );

  const availablePrompts = derived(
    [settings, prompts, activeChainPrompts],
    ([$settings, $prompts, $activeChainPrompts]) => {
      if (!$settings || !$prompts || !$activeChainPrompts) return [];
      const activeIds = new Set($settings.activePromptChain);
      const allPromptsMap = new Map<
        string,
        EnhancementPrompt | DefaultPrompt
      >();
      if (!activeIds.has("default")) {
        allPromptsMap.set("default", {
          id: "default",
          name: "Default Prompt",
          template: defaultPromptContent,
          temperature: DEFAULT_PROMPT_TEMPERATURE,
        });
      }
      $prompts.forEach((p) => {
        if (!activeIds.has(p.id)) {
          allPromptsMap.set(p.id, {
            ...p,
            temperature: p.temperature ?? DEFAULT_PROMPT_TEMPERATURE,
          });
        }
      });
      return Array.from(allPromptsMap.values());
    },
  );

  onMount(async () => {
    try {
      const storedSettingsPromise = window.api.getStoreValue(
        "enhancements",
      ) as Promise<Partial<EnhancementSettings> | undefined>;
      const storedPromptsPromise = window.api.getStoreValue(
        "enhancementPrompts",
      ) as Promise<Partial<EnhancementPrompt>[] | undefined>;
      const defaultPromptContentPromise = window.api.getDefaultPromptContent();

      const [storedSettings, storedPromptsResult, fetchedDefaultContent] =
        await Promise.all([
          storedSettingsPromise,
          storedPromptsPromise,
          defaultPromptContentPromise,
        ]);

      defaultPromptContent = fetchedDefaultContent;

      if (storedSettings) {
        settings.update((currentDefaults) => ({
          ...currentDefaults,
          ...storedSettings,
          activePromptChain: Array.isArray(storedSettings.activePromptChain)
            ? storedSettings.activePromptChain
            : currentDefaults.activePromptChain,
        }));
      }

      if (storedPromptsResult) {
        const migratedPrompts = storedPromptsResult
          .filter((p) => p?.id && p.name && p.template)
          .map((p) => ({
            id: p!.id!,
            name: p!.name!,
            template: p!.template!,
            temperature: p?.temperature ?? DEFAULT_PROMPT_TEMPERATURE,
          }));
        prompts.set(migratedPrompts as EnhancementPrompt[]);
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
      temperature: newPromptTemperature,
    };
    const currentPrompts = get(prompts);
    const updatedPrompts = [...currentPrompts, newPrompt];
    try {
      await window.api.setStoreValue("enhancementPrompts", updatedPrompts);
      prompts.set(updatedPrompts);
      newPromptName = "";
      newPromptTemplate = "";
      newPromptTemperature = DEFAULT_PROMPT_TEMPERATURE;
      showAddPrompt = false;
      window.api.log("info", `Added new enhancement prompt: ${newPrompt.name}`);
    } catch (error) {
      window.api.log("error", "Failed to save new prompt:", error);
      alert("Failed to save the new prompt.");
    }
  };

  const deletePrompt = async (idToDelete: string) => {
    if (idToDelete === "default") return;
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
      updatedChain.push("default");
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

  const openPromptModal = (promptId: string, mode: "view" | "edit") => {
    let foundPrompt: EnhancementPrompt | DefaultPrompt | null = null;
    if (promptId === "default") {
      if (!defaultPromptContent) {
        window.api.log("error", "Default prompt content not loaded yet.");
        alert("Default prompt content not available.");
        return;
      }
      foundPrompt = {
        id: "default",
        name: "Default Prompt",
        template: defaultPromptContent,
        temperature: DEFAULT_PROMPT_TEMPERATURE,
      };
    } else {
      const customPrompt = get(prompts).find((p) => p.id === promptId);
      if (customPrompt) {
        foundPrompt = {
          ...customPrompt,
          temperature: customPrompt.temperature ?? DEFAULT_PROMPT_TEMPERATURE,
        };
      }
    }

    if (foundPrompt) {
      currentPrompt = foundPrompt;
      modalMode = mode;
      editPromptName = foundPrompt.name;
      editPromptTemplate = foundPrompt.template;
      editPromptTemperature = foundPrompt.temperature;
      showPromptModal = true;
    } else {
      window.api.log("error", `Prompt not found for ${mode}: ${promptId}`);
    }
  };

  const saveEditedPrompt = async () => {
    if (!currentPrompt || currentPrompt.id === "default") return;
    if (!editPromptName.trim() || !editPromptTemplate.trim()) {
      alert("Prompt name and template cannot be empty.");
      return;
    }
    if (currentPrompt.id === "default") return;
    const updatedPrompt: EnhancementPrompt = {
      ...currentPrompt,
      name: editPromptName.trim(),
      template: editPromptTemplate.trim(),
      temperature: editPromptTemperature,
    };
    const currentPrompts = get(prompts);
    const updatedPrompts = currentPrompts.map((p) =>
      p.id === updatedPrompt.id ? updatedPrompt : p,
    );

    try {
      await window.api.setStoreValue("enhancementPrompts", updatedPrompts);
      prompts.set(updatedPrompts);
      window.api.log("info", `Updated prompt: ${updatedPrompt.name}`);
      closeModal();
    } catch (error) {
      window.api.log("error", "Failed to save updated prompt:", error);
      alert("Failed to save the updated prompt.");
    }
  };

  const handleChainSort = (
    e: CustomEvent<{ items: (EnhancementPrompt | DefaultPrompt)[] }>,
  ) => {
    const newChainOrder = e.detail.items.map((item) => item.id);
    settings.update((s) => ({ ...s, activePromptChain: newChainOrder }));
  };

  const handleAddAvailableToSort = (
    e: CustomEvent<{ items: (EnhancementPrompt | DefaultPrompt)[] }>,
  ) => {
    console.log("Item removed from available:", e.detail.items);
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
        <label class="label" for="enable-enhancements-toggle"
          ><span class="label-text-alt">Must be OpenAI API compatible.</span
          ></label
        >
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
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                bind:checked={$settings.useContextScreen}
              />
              <span class="label-text">Screen Content</span>
              <span
                class="tooltip tooltip-right"
                data-tip="Include text content from the active screen (if available). Use {'{{context_screen}}'} in prompt."
              >
                <i class="ri-information-line opacity-50"></i>
              </span>
            </label>
          </div>
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                bind:checked={$settings.useContextInputField}
              />
              <span class="label-text">Input Field</span>
              <span
                class="tooltip tooltip-right"
                data-tip="Include text content from the active input field (if available). Use {'{{context_input_field}}'} in prompt."
              >
                <i class="ri-information-line opacity-50"></i>
              </span>
            </label>
          </div>
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                bind:checked={$settings.useContextClipboard}
              />
              <span class="label-text">Clipboard</span>
              <span
                class="tooltip tooltip-right"
                data-tip="Include text content from the clipboard. Use {'{{context_clipboard}}'} in prompt."
              >
                <i class="ri-information-line opacity-50"></i>
              </span>
            </label>
          </div>
        </div>

        <div class="divider pt-4">Enhancement Prompt Chain</div>
        <p class="text-sm opacity-70 -mt-4 mb-4">
          Drag prompts between "Available" and "Active Chain". Prompts in the
          chain run sequentially top-to-bottom.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section>
            <h3 class="font-medium mb-2">Active Chain</h3>
            <div
              class="border border-base-300 rounded-md p-2 min-h-24 space-y-2 bg-base-200"
              use:dndzone={{ items: $activeChainPrompts, ...dndOptions }}
              on:consider={handleChainSort}
              on:finalize={handleChainSort}
            >
              {#each $activeChainPrompts as prompt, i (prompt.id)}
                <div
                  class="p-2 bg-base-100 rounded shadow-sm flex items-center gap-2 cursor-grab active:cursor-grabbing"
                >
                  <span class="font-mono text-xs opacity-50 w-4 text-center"
                    >{i + 1}</span
                  >
                  <span class="flex-1 truncate" title={prompt.name}
                    >{prompt.name}</span
                  >
                  {#if prompt.id !== "default"}
                    <span class="text-xs opacity-60"
                      >T: {prompt.temperature.toFixed(1)}</span
                    >
                  {/if}
                  <button
                    class="btn btn-xs btn-ghost"
                    title="View/Edit Prompt"
                    aria-label="View/Edit Prompt"
                    on:click|stopPropagation|preventDefault={() =>
                      openPromptModal(
                        prompt.id,
                        prompt.id === "default" ? "view" : "edit",
                      )}
                  >
                    {#if prompt.id === "default"}
                      <i class="ri-eye-line"></i>
                    {:else}
                      <i class="ri-pencil-line"></i>
                    {/if}
                  </button>
                  {#if $activeChainPrompts.length > 1}
                    <button
                      class="btn btn-xs btn-ghost text-warning"
                      title="Remove from Chain"
                      aria-label="Remove from Chain"
                      on:click|stopPropagation|preventDefault={() => {
                        const newChain = $activeChainPrompts
                          .filter((p) => p.id !== prompt.id)
                          .map((p) => p.id);
                        settings.update((s) => ({
                          ...s,
                          activePromptChain: newChain,
                        }));
                      }}
                    >
                      <i class="ri-arrow-go-back-line"></i>
                    </button>
                  {/if}
                </div>
              {:else}
                <p class="text-sm text-center opacity-60 py-4">
                  Drag available prompts here to activate.
                </p>
              {/each}
            </div>
          </section>

          <section>
            <h3 class="font-medium mb-2">Available Prompts</h3>
            <div
              class="border border-base-300 rounded-md p-2 min-h-24 space-y-2 bg-base-200"
              use:dndzone={{ items: $availablePrompts, ...dndOptions }}
              on:consider={handleAddAvailableToSort}
              on:finalize={handleAddAvailableToSort}
            >
              {#each $availablePrompts as prompt (prompt.id)}
                <div
                  class="p-2 bg-base-100 rounded shadow-sm flex items-center gap-2 cursor-grab active:cursor-grabbing"
                >
                  <span class="flex-1 truncate" title={prompt.name}
                    >{prompt.name}</span
                  >
                  {#if prompt.id !== "default"}
                    <span class="text-xs opacity-60"
                      >T: {prompt.temperature.toFixed(1)}</span
                    >
                  {/if}
                  <button
                    class="btn btn-xs btn-ghost"
                    title="View/Edit Prompt"
                    aria-label="View/Edit Prompt"
                    on:click|stopPropagation|preventDefault={() =>
                      openPromptModal(
                        prompt.id,
                        prompt.id === "default" ? "view" : "edit",
                      )}
                  >
                    {#if prompt.id === "default"}
                      <i class="ri-eye-line"></i>
                    {:else}
                      <i class="ri-pencil-line"></i>
                    {/if}
                  </button>
                  {#if prompt.id !== "default"}
                    <button
                      class="btn btn-xs btn-ghost text-error"
                      title="Delete Prompt Permanently"
                      aria-label="Delete Prompt Permanently"
                      on:click|stopPropagation|preventDefault={() =>
                        deletePrompt(prompt.id)}
                    >
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  {/if}
                </div>
              {:else}
                <p class="text-sm text-center opacity-60 py-4">
                  No other prompts available.
                </p>
              {/each}
            </div>
          </section>
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
                    newPromptTemperature = DEFAULT_PROMPT_TEMPERATURE;
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
      {:else if modalMode === "edit" && currentPrompt.id !== "default"}
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
      {:else if modalMode === "edit" && currentPrompt.id === "default"}
        <p class="text-warning">
          The default prompt's template and temperature cannot be edited.
        </p>
      {/if}

      <div class="modal-action mt-6">
        <button class="btn btn-ghost" on:click={closeModal}>Close</button>
        {#if modalMode === "edit" && currentPrompt?.id !== "default"}
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
