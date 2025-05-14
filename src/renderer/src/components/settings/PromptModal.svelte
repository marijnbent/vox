<script lang="ts">
  import { createEventDispatcher } from "svelte";
  // Types
  export interface PromptModalProps {
    show: boolean;
    mode: "view" | "edit" | "add";
    prompt: any | null; // DisplayablePrompt or null
    systemDefaultIds: Set<string>;
    fallbackTemperature: number;
  }
  export let show: boolean;
  export let mode: "view" | "edit" | "add";
  export let prompt: any | null;
  export let systemDefaultIds: Set<string>;
  export let fallbackTemperature: number = 0.7;

  // For editing/adding
  let name = "";
  let template = "";
  let temperature = fallbackTemperature;

  const dispatch = createEventDispatcher();

  $: if (show && prompt && (mode === "edit" || mode === "view")) {
    name = prompt.name;
    template = prompt.template;
    temperature = prompt.temperature ?? fallbackTemperature;
  }
  $: if (show && mode === "add") {
    name = "";
    template = "";
    temperature = fallbackTemperature;
  }

  function close() {
    dispatch("close");
  }
  function save() {
    if (!name.trim() || !template.trim()) {
      alert("Prompt name and template cannot be empty.");
      return;
    }
    dispatch("save", { name, template, temperature });
  }
</script>

{#if show}
  <dialog id="prompt_modal" class="modal modal-open">
    <div class="modal-box w-11/12 max-w-2xl">
      <h3 class="font-bold text-lg mb-4">
        {#if mode === "view"}
          View Prompt: {prompt?.name}
        {:else if mode === "edit"}
          Edit Prompt: {prompt?.name}
        {:else if mode === "add"}
          Add New Prompt
        {/if}
      </h3>

      {#if mode === "view"}
        <div class="space-y-4">
          <div>
            <div class="label">
              <span class="label-text font-semibold">Name:</span>
            </div>
            <p class="p-2 bg-base-200 rounded">{prompt.name}</p>
          </div>
          <div>
            <div class="label">
              <span class="label-text font-semibold">Template:</span>
            </div>
            <pre class="p-2 bg-base-200 rounded text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{prompt.template}</pre>
          </div>
          <div>
            <div class="label">
              <span class="label-text font-semibold">Temperature:</span>
            </div>
            <p class="p-2 bg-base-200 rounded">{prompt.temperature.toFixed(1)}</p>
          </div>
        </div>
      {:else if mode === "edit" && !systemDefaultIds.has(prompt.id)}
        <div class="space-y-4">
          <div class="form-control">
            <label class="label py-1" for="edit-prompt-name"><span class="label-text">Prompt Name:</span></label>
            <input id="edit-prompt-name" type="text" class="input input-bordered w-full" bind:value={name} />
          </div>
          <div class="form-control">
            <label class="label py-1" for="edit-prompt-template"><span class="label-text">Prompt Template:</span></label>
            <textarea id="edit-prompt-template" class="textarea textarea-bordered w-full" rows="6" placeholder="Use {'{{transcription}}'} or {'{{previous_output}}'}..." bind:value={template}></textarea>
            <span class="pt-2 block-inline text-sm">Variables: <code class="kbd kbd-xs h-auto">{"{{transcription}}"}</code>, <code class="kbd kbd-xs h-auto">{"{{previous_output}}"}</code>, context vars, etc.</span>
          </div>
          <div class="form-control">
            <label class="label" for="edit-prompt-temperature">
              <span class="label-text">Temperature:</span>
              <span class="label-text-alt">{temperature.toFixed(1)}</span>
            </label>
            <input id="edit-prompt-temperature" type="range" min="0" max="2" step="0.1" bind:value={temperature} class="range range-primary range-sm" />
            <div class="w-full flex justify-between text-xs px-2 pt-1">
              <span>Precise</span><span>Balanced</span><span>Creative</span>
            </div>
          </div>
        </div>
      {:else if mode === "add"}
        <div class="space-y-4">
          <div class="form-control">
            <label class="label py-1" for="add-prompt-name"><span class="label-text">Prompt Name:</span></label>
            <input id="add-prompt-name" type="text" class="input input-bordered w-full" bind:value={name} />
          </div>
          <div class="form-control">
            <label class="label py-1" for="add-prompt-template"><span class="label-text">Prompt Template:</span></label>
            <textarea id="add-prompt-template" class="textarea textarea-bordered w-full" rows="6" placeholder="Use {'{{transcription}}'} or {'{{previous_output}}'}..." bind:value={template}></textarea>
            <span class="pt-2 block-inline text-sm">Variables: <code class="kbd kbd-xs h-auto">{"{{transcription}}"}</code>, <code class="kbd kbd-xs h-auto">{"{{previous_output}}"}</code>, context vars, etc.</span>
          </div>
          <div class="form-control">
            <label class="label" for="add-prompt-temperature">
              <span class="label-text">Temperature:</span>
              <span class="label-text-alt">{temperature.toFixed(1)}</span>
            </label>
            <input id="add-prompt-temperature" type="range" min="0" max="2" step="0.1" bind:value={temperature} class="range range-primary range-sm" />
            <div class="w-full flex justify-between text-xs px-2 pt-1">
              <span>Precise</span><span>Balanced</span><span>Creative</span>
            </div>
          </div>
        </div>
      {:else if mode === "edit" && systemDefaultIds.has(prompt.id)}
        <p class="text-warning">System default prompts cannot be edited.</p>
      {/if}

      <div class="modal-action mt-6">
        <button class="btn btn-ghost" on:click={close}>Close</button>
        {#if (mode === "edit" && prompt && !systemDefaultIds.has(prompt.id)) || mode === "add"}
          <button class="btn btn-primary" on:click={save}>Save Changes</button>
        {/if}
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button on:click={close}>close</button>
    </form>
  </dialog>
{/if}
