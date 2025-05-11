<script lang="ts">
  import { onMount } from 'svelte';
  import { v4 as uuidv4 } from 'uuid';
  import { writable, get } from 'svelte/store';

  interface EnhancementSettings {
    enabled: boolean;
    provider: 'openai' | 'gemini' | 'custom';
    openaiApiKey: string;
    openaiModel: 'gpt-4.1' | 'gpt-4.1-mini';
    openaiBaseUrl?: string;
    geminiApiKey: string;
    geminiModel: 'gemini-2.0-flash' | 'gemini-2.5-flash' | 'gemini-2.0-flash-lite';
    customApiKey: string;
    customModelName: string;
    customBaseUrl?: string;
    activePromptId: string;
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
  }

  const settings = writable<EnhancementSettings>({
    enabled: false,
    provider: 'openai',
    openaiApiKey: '',
    openaiModel: 'gpt-4.1-mini',
    openaiBaseUrl: '',
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    customApiKey: '',
    customModelName: '',
    customBaseUrl: '',
    activePromptId: 'default',
    useTranscript: true,
    useContextScreen: false,
    useContextInputField: false,
    useContextClipboard: false,
    useDictionaryWordList: false
  });

  let isLoading = true;
  const prompts = writable<EnhancementPrompt[]>([]);
  let newPromptName = '';
  let newPromptTemplate = '';
  let showAddPrompt = false;
  let showPromptModal = false;
  let modalMode: 'view' | 'edit' | 'add' = 'add';
  let currentPrompt: EnhancementPrompt | { id: 'default', name: string, template: string } | null = null;
  let editPromptName = '';
  let editPromptTemplate = '';

  onMount(async () => {
    try {
      const storedSettingsPromise = window.api.getStoreValue('enhancements') as Promise<EnhancementSettings | undefined>;
      const storedPromptsPromise = window.api.getStoreValue('enhancementPrompts') as Promise<EnhancementPrompt[] | undefined>;

      const [storedSettings, storedPrompts] = await Promise.all([storedSettingsPromise, storedPromptsPromise]);

      if (storedSettings) {
        settings.set({ ...storedSettings });
      }
      if (storedPrompts) {
        prompts.set([...storedPrompts]);
      }
    } catch (error) {
      window.api.log('error', 'Failed to load enhancement settings:', error);
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
              await window.api.setStoreValue('enhancements', currentSettings);
              window.api.log('info', 'Enhancement settings auto-saved.');
          } catch (error) {
              window.api.log('error', 'Failed to auto-save enhancement settings:', error);
          }
      }, 500);
  };

  const addPrompt = async () => {
    if (!newPromptName.trim() || !newPromptTemplate.trim()) {
      alert('Please provide both a name and a template for the new prompt.');
      return;
    }
    const newPrompt: EnhancementPrompt = {
      id: uuidv4(),
      name: newPromptName.trim(),
      template: newPromptTemplate.trim()
    };
    const currentPrompts = get(prompts);
    const updatedPrompts = [...currentPrompts, newPrompt];
    try {
      await window.api.setStoreValue('enhancementPrompts', updatedPrompts);
      prompts.set(updatedPrompts);
      newPromptName = '';
      newPromptTemplate = '';
      showAddPrompt = false;
      window.api.log('info', `Added new enhancement prompt: ${newPrompt.name}`);
    } catch (error) {
      window.api.log('error', 'Failed to save new prompt:', error);
      alert('Failed to save the new prompt.');
    }
  };

  const deletePrompt = async (idToDelete: string) => {
    if (idToDelete === 'default') return;
    if (!confirm('Are you sure you want to delete this prompt?')) return;

    const currentPrompts = get(prompts);
    const updatedPrompts = currentPrompts.filter(p => p.id !== idToDelete);
    try {
      await window.api.setStoreValue('enhancementPrompts', updatedPrompts);
      prompts.set(updatedPrompts);

      if (get(settings).activePromptId === idToDelete) {
        settings.update(s => ({ ...s, activePromptId: 'default' }));
        await saveSettings(get(settings));
      }
      window.api.log('info', `Deleted enhancement prompt ID: ${idToDelete}`);
    } catch (error) {
      window.api.log('error', 'Failed to delete prompt:', error);
      alert('Failed to delete the prompt.');
    }
  };

  const closeModal = () => {
    showPromptModal = false;
    currentPrompt = null;
    editPromptName = '';
    editPromptTemplate = '';
  };

  const viewPrompt = async (promptId: string) => {
    if (promptId === 'default') {
      try {
        const defaultTemplate = await window.api.getDefaultPromptContent();
        currentPrompt = {
          id: 'default',
          name: 'Default Prompt',
          template: defaultTemplate
        };
      } catch (err) {
        window.api.log('error', 'Failed to fetch default prompt content:', err);
        alert('Could not load default prompt content.');
        return;
      }
    } else {
      currentPrompt = get(prompts).find(p => p.id === promptId) || null;
    }

    if (currentPrompt) {
      modalMode = 'view';
      editPromptName = currentPrompt.name;
      editPromptTemplate = currentPrompt.template;
      showPromptModal = true;
    } else {
      window.api.log('error', `Prompt not found for viewing: ${promptId}`);
    }
  };

  const editPrompt = (promptToEdit: EnhancementPrompt) => {
    currentPrompt = promptToEdit;
    modalMode = 'edit';
    editPromptName = promptToEdit.name;
    editPromptTemplate = promptToEdit.template;
    showPromptModal = true;
  };

  const saveEditedPrompt = async () => {
    if (!currentPrompt || currentPrompt.id === 'default') return;
    if (!editPromptName.trim() || !editPromptTemplate.trim()) {
      alert('Prompt name and template cannot be empty.');
      return;
    }

    const updatedPrompt: EnhancementPrompt = {
      ...currentPrompt,
      name: editPromptName.trim(),
      template: editPromptTemplate.trim()
    };

    const currentPrompts = get(prompts);
    const updatedPrompts = currentPrompts.map(p => p.id === updatedPrompt.id ? updatedPrompt : p);

    try {
      await window.api.setStoreValue('enhancementPrompts', updatedPrompts);
      prompts.set(updatedPrompts);
      window.api.log('info', `Updated prompt: ${updatedPrompt.name}`);
      closeModal();
    } catch (error) {
      window.api.log('error', 'Failed to save updated prompt:', error);
      alert('Failed to save the updated prompt.');
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
            When enabled, transcriptions can be processed by an LLM to improve formatting, fix grammar, etc.
          </p>
          <label class="label" for="enable-enhancements-toggle"><span class="label-text-alt">Must be OpenAI API compatible.</span></label>
        </div>

        {#if $settings.enabled}
          <div class="divider pt-4">Enhancement Provider</div>

          <div class="flex flex-wrap gap-4 items-center">
             <div class="form-control">
               <label class="label cursor-pointer gap-2">
                 <input type="radio" name="enhancement-provider" class="radio radio-sm" value="openai" bind:group={$settings.provider} />
                 <span class="label-text">OpenAI</span>
               </label>
             </div>
             <div class="form-control">
               <label class="label cursor-pointer gap-2">
                 <input type="radio" name="enhancement-provider" class="radio radio-sm" value="gemini" bind:group={$settings.provider} />
                 <span class="label-text">Gemini</span>
               </label>
             </div>
             <div class="form-control">
               <label class="label cursor-pointer gap-2">
                 <input type="radio" name="enhancement-provider" class="radio radio-sm" value="custom" bind:group={$settings.provider} />
                 <span class="label-text">Custom</span>
               </label>
             </div>
          </div>

          {#if $settings.provider === 'openai'}
            <div class="mt-4 p-4 border border-base-300 rounded-md space-y-4">
               <h3 class="font-medium">OpenAI Configuration</h3>
               <div class="form-control">
                 <label class="label" for="openai-enh-api-key">
                   <span class="label-text">OpenAI API Key*</span>
                 </label>
                 <input id="openai-enh-api-key" type="password" placeholder="sk-..." class="input input-bordered input-sm w-full" bind:value={$settings.openaiApiKey} />
               </div>
               <div class="form-control">
                 <label class="label" for="openai-enh-model-select">
                   <span class="label-text">OpenAI Model*</span>
                 </label>
                 <select id="openai-enh-model-select" class="select select-bordered select-sm w-full max-w-xs" bind:value={$settings.openaiModel}>
                   <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                   <option value="gpt-4.1">GPT-4.1</option>
                 </select>
               </div>

            </div>
          {:else if $settings.provider === 'gemini'}
             <div class="mt-4 p-4 border border-base-300 rounded-md space-y-4">
                <h3 class="font-medium">Gemini Configuration</h3>
                <div class="form-control">
                  <label class="label" for="gemini-api-key">
                    <span class="label-text">Gemini API Key*</span>
                  </label>
                  <input id="gemini-api-key" type="password" placeholder="AIza..." class="input input-bordered input-sm w-full" bind:value={$settings.geminiApiKey} />
                </div>
                <div class="form-control">
                  <label class="label" for="gemini-model-select">
                    <span class="label-text">Gemini Model*</span>
                  </label>
                  <select id="gemini-model-select" class="select select-bordered select-sm w-full max-w-xs" bind:value={$settings.geminiModel}>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  </select>
                </div>
             </div>
          {:else if $settings.provider === 'custom'}
             <div class="mt-4 p-4 border border-base-300 rounded-md space-y-4">
                <h3 class="font-medium">Custom Provider Configuration</h3>

                <div class="form-control">
                  <label class="label" for="custom-base-url">
                    <span class="label-text">Base URL</span>
                  </label>
                  <input id="custom-base-url" type="text" placeholder="eg. https://api.mistral.ai/v1/" class="input input-bordered input-sm w-full" bind:value={$settings.customBaseUrl} />
                  <label class="label" for="custom-base-url"><span class="label-text-alt text-xs">Must be OpenAI API compatible.</span></label>
                </div>

                <div class="form-control">
                  <label class="label" for="custom-model-name">
                    <span class="label-text">Model Name</span>
                  </label>
                  <input id="custom-model-name" type="text" placeholder="e.g. mistral-small-latest" class="input input-bordered input-sm w-full" bind:value={$settings.customModelName} />
                </div>


                 <div class="form-control">
                   <label class="label" for="custom-api-key">
                     <span class="label-text">API Key</span>
                   </label>
                   <input id="custom-api-key" type="password" placeholder="Enter API Key" class="input input-bordered input-sm w-full" bind:value={$settings.customApiKey} />
                 </div>

             </div>
          {/if}

          <div class="divider py-4">Context Variables</div>
          <p class="text-sm opacity-70 -mt-4 mb-4">
            Enable context sources to include them in your prompts using placeholders like <code class="kbd kbd-xs">{'{{context_screen}}'}</code>. (Note: Context capture is not yet implemented).
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                      <input type="checkbox" class="toggle toggle-sm" bind:checked={$settings.useContextScreen} />
                      <span class="label-text">Screen Content</span>
                      <span class="tooltip tooltip-right" data-tip="Include text content from the active screen (if available). Use {'{{context_screen}}'} in prompt.">
                          <i class="ri-information-line opacity-50"></i>
                      </span>
                  </label>
              </div>
              <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                      <input type="checkbox" class="toggle toggle-sm" bind:checked={$settings.useContextInputField} />
                      <span class="label-text">Input Field</span>
                       <span class="tooltip tooltip-right" data-tip="Include text content from the active input field (if available). Use {'{{context_input_field}}'} in prompt.">
                          <i class="ri-information-line opacity-50"></i>
                      </span>
                  </label>
              </div>
              <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-3">
                      <input type="checkbox" class="toggle toggle-sm" bind:checked={$settings.useContextClipboard} />
                      <span class="label-text">Clipboard</span>
                       <span class="tooltip tooltip-right" data-tip="Include text content from the clipboard. Use {'{{context_clipboard}}'} in prompt.">
                          <i class="ri-information-line opacity-50"></i>
                      </span>
                  </label>
              </div>
          </div>

          <div class="divider pt-4">Active Enhancement Prompt</div>
          <div class="space-y-2">
             <div class="form-control">
                <label class="label cursor-pointer justify-start gap-2 p-2 rounded hover:bg-base-300 group">
                  <input type="radio" name="active-prompt" class="radio radio-sm" value="default" bind:group={$settings.activePromptId} />
                  <span class="label-text font-medium">Default Prompt</span>
                  <span class="text-xs opacity-60 ml-auto mr-2">(Basic formatting)</span>
                   <button
                     class="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity"
                     title="View Default Prompt"
                     aria-label="View Default Prompt"
                     on:click|stopPropagation|preventDefault={() => viewPrompt('default')}
                   >
                     <i class="ri-eye-line"></i>
                   </button>
                </label>
             </div>
             {#each $prompts as prompt (prompt.id)}
                <div class="form-control">
                  <label class="label cursor-pointer justify-start gap-2 p-2 rounded hover:bg-base-300 group">
                    <input type="radio" name="active-prompt" class="radio radio-sm" value={prompt.id} bind:group={$settings.activePromptId}  />
                    <span class="label-text flex-1 truncate" title={prompt.name}>{prompt.name}</span>
                    <button
                      class="btn btn-xs btn-ghost opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                      title="Edit Prompt"
                      aria-label="Edit Prompt"
                      on:click|stopPropagation|preventDefault={() => editPrompt(prompt)}
                    >
                       <i class="ri-pencil-line"></i>
                    </button>

                    <button
                      class="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete Prompt"
                      aria-label="Delete Prompt"
                      on:click|stopPropagation|preventDefault={() => deletePrompt(prompt.id)}
                    >
                      <i class="ri-delete-bin-line"></i>
                    </button>
                  </label>
                </div>
             {/each}
          </div>

          <div class="mt-4">
             {#if showAddPrompt}
                <div class="p-4 border border-base-300 rounded-md space-y-3">
                   <h4 class="font-medium">Add New Prompt</h4>
                   <div class="form-control">
                      <label class="label py-1" for="new-prompt-name"><span class="label-text">Prompt Name:</span></label>
                      <input id="new-prompt-name" type="text" placeholder="e.g., Formal Report Style" class="input input-bordered input-sm w-full" bind:value={newPromptName} />
                   </div>
                    <div class="form-control">
                      <label class="label py-1" for="new-prompt-template"><span class="label-text">Prompt Template:</span></label>
                      <textarea id="new-prompt-template" class="textarea textarea-bordered w-full" rows="4" placeholder="Enter your prompt. Use {'{{transcription}}'} where the text should be inserted." bind:value={newPromptTemplate}></textarea>
                      <span class="pt-2 block-inline text-sm">Use <a target="_blank" class="underline" href="https://mustache.github.io/mustache.5.html">mustache templating</a>. Variables: <code class="kbd kbd-xs h-auto">{'{{transcription}}, {{dictionary_words}}, {{context_screen}}, {{context_clipboard}}, {{context_input_field}}'}</code></span>
                   </div>
                   <div class="flex justify-end gap-2 pt-2">
                      <button class="btn btn-sm btn-ghost" on:click={() => { showAddPrompt = false; newPromptName=''; newPromptTemplate=''; }}>Cancel</button>
                      <button class="btn btn-sm btn-primary" on:click={addPrompt}>Add Prompt</button>
                   </div>
                </div>
             {:else}
                <button class="btn btn-sm btn-outline" on:click={() => { showAddPrompt = true; }}>
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
      {#if modalMode === 'view'}
        View Prompt: {currentPrompt.name}
      {:else if modalMode === 'edit'}
        Edit Prompt: {currentPrompt.name}
      {/if}
    </h3>

    {#if modalMode === 'view'}
      <div class="space-y-4">
        <div>
          <div class="label"><span class="label-text font-semibold">Name:</span></div>
          <p class="p-2 bg-base-200 rounded">{currentPrompt.name}</p>
        </div>
        <div>
          <div class="label"><span class="label-text font-semibold">Template:</span></div>
          <pre class="p-2 bg-base-200 rounded text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{currentPrompt.template}</pre>
        </div>
      </div>
    {:else if modalMode === 'edit'}
      <div class="space-y-4">
         <div class="form-control">
            <label class="label py-1" for="edit-prompt-name"><span class="label-text">Prompt Name:</span></label>
            <input id="edit-prompt-name" type="text" class="input input-bordered w-full" bind:value={editPromptName} />
         </div>
          <div class="form-control">
            <label class="label py-1" for="edit-prompt-template"><span class="label-text">Prompt Template:</span></label>
            <textarea id="edit-prompt-template" class="textarea textarea-bordered w-full" rows="6" placeholder="Use {'{{transcription}}'} where the text should be inserted." bind:value={editPromptTemplate}></textarea>
         </div>
      </div>
    {/if}

    <div class="modal-action mt-6">
      <button class="btn btn-ghost" on:click={closeModal}>Close</button>
      {#if modalMode === 'edit'}
        <button class="btn btn-primary" on:click={saveEditedPrompt}>Save Changes</button>
      {/if}
    </div>
  </div>
  <form method="dialog" class="modal-backdrop">
    <button on:click={closeModal}>close</button>
  </form>
</dialog>
{/if}
