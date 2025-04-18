<script lang="ts">
  import { onMount } from "svelte";
  import { writable, get } from "svelte/store";

  const openaiApiKey = writable("");
  const openaiModel = writable<"gpt-4o-mini-transcribe" | "gpt-4o-transcribe">(
    "gpt-4o-mini-transcribe",
  );
  const provider = writable<"openai" | "deepgram" | "local">("openai");
  const deepgramApiKey = writable("");
  const deepgramModel = writable<"nova-3" | "enhanced" | "whisper-large">(
    "nova-3",
  );
  const localModelName = writable<string>("base");

  const availableLocalModelsStore = writable<
    { value: string; label: string }[]
  >([]); // Store for models

  let isLoading = true;
  let downloadStatus = writable("");

  onMount(async () => {
    try {
      const initialSettingsPromise = window.api.getStoreValue(
        "transcription",
      ) as Promise<any | undefined>;
      const modelsPromise = window.api.getAvailableLocalModels();

      const [initialSettings, models] = await Promise.all([
        initialSettingsPromise,
        modelsPromise,
      ]);

      provider.set(initialSettings.provider || "openai");
      openaiApiKey.set(initialSettings.openaiApiKey || "");
      openaiModel.set(initialSettings.openaiModel || "gpt-4o-mini-transcribe");
      deepgramApiKey.set(initialSettings.deepgramApiKey || "");
      deepgramModel.set(initialSettings.deepgramModel || "nova-3");
      localModelName.set(initialSettings.localModelName || "base");

      if (models && Array.isArray(models)) {
        availableLocalModelsStore.set(
          models.map((model) => ({ value: model, label: model })),
        );
        window.api.log("info", "Loaded available local models via API.");
      } else {
        window.api.log(
          "warn",
          "Could not load available local models via API.",
        );
        availableLocalModelsStore.set([]);
      }
    } catch (error) {
      window.api.log("error", "Failed to load transcription settings:", error);
    } finally {
      isLoading = false;
    }
  });

  let saveTimeout: NodeJS.Timeout | null = null;
  const saveSettings = () => {
    if (isLoading) return;
    if (saveTimeout) clearTimeout(saveTimeout);

    const currentSettings = {
      provider: get(provider),
      openaiApiKey: get(openaiApiKey),
      openaiModel: get(openaiModel),
      deepgramApiKey: get(deepgramApiKey),
      deepgramModel: get(deepgramModel),
      localModelName: get(localModelName),
    };

    saveTimeout = setTimeout(async () => {
      try {
        await window.api.setStoreValue("transcription", currentSettings);
        window.api.log("info", "Transcription settings auto-saved.");
      } catch (error) {
        window.api.log(
          "error",
          "Failed to auto-save transcription settings:",
          error,
        );
      }
    }, 500);
  };

  $: if (!isLoading) {
    const currentProviderValue = $provider;
    const currentApiKeyValue = $openaiApiKey;
    const currentModelValue = $openaiModel;
    const currentDeepgramApiKeyValue = $deepgramApiKey;
    const currentDeepgramModelValue = $deepgramModel;
    const currentLocalModelValue = $localModelName;

    saveSettings();
    if (
      currentProviderValue !== "local" ||
      (currentProviderValue === "local" && currentLocalModelValue)
    ) {
      downloadStatus.set("");
    }
  }

  async function downloadModel() {
    const modelToDownload = get(localModelName);
    if (!modelToDownload) {
      downloadStatus.set("Please select a model first.");
      return;
    }
    downloadStatus.set(
      `Downloading model ${modelToDownload}... (This may take a while)`,
    );
    window.api.log("info", `Requesting download for model: ${modelToDownload}`);
    try {
      await window.api.downloadLocalModel(modelToDownload);
      downloadStatus.set(
        `Model ${modelToDownload} downloaded successfully (or already exists).`,
      );
      window.api.log(
        "info",
        `Model download request successful for: ${modelToDownload}`,
      );
    } catch (error: any) {
      window.api.log(
        "error",
        `Failed to download model ${modelToDownload}:`,
        error,
      );
      downloadStatus.set(
        `Error downloading model: ${error.message || "Unknown error"}`,
      );
    }
  }
</script>

<div class="p-4 space-y-6">
  <h2 class="text-xl font-semibold">Transcription Settings</h2>

  {#if isLoading}
    <p>Loading settings...</p>
  {:else}
    <div class="space-y-4">
      <!-- Provider Selection -->
      <div class="form-control">
        <label class="label" for="provider-select">
          <span class="label-text">Transcription Provider</span>
        </label>
        <select
          id="provider-select"
          class="select select-bordered w-full max-w-xs"
          bind:value={$provider}
        >
          <option value="openai">OpenAI Whisper API</option>
          <option value="deepgram">Deepgram API</option>
          <option value="local">Local Whisper Model</option>
        </select>
      </div>

      {#if $provider === "openai"}
        <div class="form-control">
          <label class="label" for="openai-api-key">
            <span class="label-text">OpenAI API Key (for Transcription)</span>
          </label>
          <input
            id="openai-api-key"
            type="password"
            placeholder="sk-..."
            class="input input-bordered w-full"
            bind:value={$openaiApiKey}
          />
          <label class="label">
            <span class="label-text-alt"
              >Required for OpenAI transcription. Get key from <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                class="link link-primary">OpenAI Platform</a
              >.</span
            >
          </label>
        </div>

        <div class="form-control">
          <label class="label" for="openai-model-select">
            <span class="label-text">OpenAI Whisper Model</span>
          </label>
          <select
            id="openai-model-select"
            class="select select-bordered w-full max-w-xs"
            bind:value={$openaiModel}
          >
            <option value="gpt-4o-mini-transcribe"
              >GPT-4o Mini Transcribe</option
            >
            <option value="gpt-4o-transcribe">GPT-4o Transcribe</option>
          </select>
          <label class="label">
            <span class="label-text-alt">Select the Whisper model to use.</span>
          </label>
        </div>
      {/if}

      {#if $provider === "deepgram"}
        <div class="form-control">
          <label class="label" for="deepgram-api-key">
            <span class="label-text">Deepgram API Key</span>
          </label>
          <input
            id="deepgram-api-key"
            type="password"
            placeholder="..."
            class="input input-bordered w-full"
            bind:value={$deepgramApiKey}
          />
          <label class="label">
            <span class="label-text-alt"
              >Required for Deepgram transcription. Get key from <a
                href="https://console.deepgram.com/signup"
                target="_blank"
                class="link link-primary">Deepgram Console</a
              >.</span
            >
          </label>
        </div>

        <div class="form-control">
          <label class="label" for="deepgram-model-select">
            <span class="label-text">Deepgram Model</span>
          </label>
          <select
            id="deepgram-model-select"
            class="select select-bordered w-full max-w-xs"
            bind:value={$deepgramModel}
          >
            <option value="nova-3">Nova 3 (Best)</option>
            <option value="enhanced">Enhanced</option>
            <option value="whisper-large">Whisper Large</option>
          </select>
          <label class="label">
            <span class="label-text-alt">Select the Deepgram model to use.</span
            >
          </label>
        </div>
      {/if}

      {#if $provider === "local"}
        <div class="form-control w-full max-w-md space-y-4">
          <div>
            <label class="label" for="local-model-select">
              <span class="label-text">Local Whisper Model</span>
              <span class="label-text-alt"
                >Models are downloaded on demand.</span
              >
            </label>
            <select
              id="local-model-select"
              class="select select-bordered w-full"
              bind:value={$localModelName}
              disabled={$availableLocalModelsStore.length === 0}
            >
              {#if $availableLocalModelsStore.length === 0 && !isLoading}
                <option value="" disabled selected>Could not load models</option
                >
              {/if}
              {#each $availableLocalModelsStore as model}
                <option value={model.value}>{model.label}</option>
              {/each}
            </select>
            <label class="label">
              <span class="label-text-alt"
                >Larger models are more accurate but slower and require more
                resources. `.en` models are English-only.</span
              >
            </label>
          </div>

          <div>
            <button
              class="btn btn-secondary btn-sm"
              on:click={downloadModel}
              disabled={!$localModelName}
            >
              Download/Verify Model: {$localModelName || "Select Model"}
            </button>
            {#if $downloadStatus}
              <p class="text-sm mt-2">{$downloadStatus}</p>
            {/if}
            <p class="text-xs text-base-content/70 mt-1">
              Clicking download will fetch the selected model if it's not
              already present locally. This uses the `npx nodejs-whisper
              download` command. Check console/logs for detailed progress.
            </p>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
