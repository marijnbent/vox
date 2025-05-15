<script lang="ts">
  import { onMount } from "svelte";
  import { writable, get } from "svelte/store";

  const openaiApiKey = writable("");
  const openaiModel = writable<"gpt-4o-mini-transcribe" | "gpt-4o-transcribe">(
    "gpt-4o-mini-transcribe",
  );
  const provider = writable<"openai" | "deepgram">("openai");
  const deepgramApiKey = writable("");
  const deepgramModel = writable<"nova-3" | "enhanced" | "whisper-large">(
    "nova-3",
  );
  const musicManagementEnabled = writable(true);
  const musicManagementAction = writable<"none" | "pause" | "lowerVolume">(
    "pause",
  );

  let isLoading = true;

  onMount(async () => {
    try {
      const initialSettingsPromise = window.api.getStoreValue(
        "transcription",
      ) as Promise<any | undefined>;

      const [initialSettings] = await Promise.all([
        initialSettingsPromise,
      ]);

      const currentProvider = initialSettings.provider;
      if (currentProvider === 'openai' || currentProvider === 'deepgram') {
          provider.set(currentProvider);
      } else {
          provider.set('deepgram');
          window.api.log('warn', `Invalid or local provider "${currentProvider}" found in settings, defaulting to deepgram.`);
      }

      openaiApiKey.set(initialSettings.openaiApiKey || "");
      openaiModel.set(initialSettings.openaiModel || "gpt-4o-mini-transcribe");
      deepgramApiKey.set(initialSettings.deepgramApiKey || "");
      deepgramModel.set(initialSettings.deepgramModel || "nova-3");
      musicManagementEnabled.set(
        initialSettings.musicManagementEnabled === undefined
          ? true // Default to true if not set
          : initialSettings.musicManagementEnabled,
      );
      musicManagementAction.set(
        initialSettings.musicManagementAction || "pause", // Default to pause if not set
      );
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
      musicManagementEnabled: get(musicManagementEnabled),
      musicManagementAction: get(musicManagementAction),
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
    const currentMusicManagementEnabled = $musicManagementEnabled;
    const currentMusicManagementAction = $musicManagementAction;

    saveSettings();
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
          <label class="label" for="openai-api-key">
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
          <label class="label" for="openai-model-select">
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
          <label class="label" for="deepgram-api-key">
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
          <label class="label" for="deepgram-model-select">
            <span class="label-text-alt">Select the Deepgram model to use.</span
            >
          </label>
        </div>
      {/if}

      <!-- Music Management Settings -->
      <div class="divider"></div>
      <h3 class="text-lg font-medium">Music Management During Recording</h3>
      {#if $musicManagementEnabled}
        <div class="form-control">
          <label class="label" for="music-action-select">
            <span class="label-text">Action to take:</span>
          </label>
          <select
            id="music-action-select"
            class="select select-bordered w-full max-w-xs"
            bind:value={$musicManagementAction}
          >
            <option value="pause">Pause Music</option>
            <option value="lowerVolume">Lower Music Volume</option>
            <option value="none">Do Nothing</option>
          </select>
          <label class="label" for="music-action-select">
            <span class="label-text-alt"
              >Choose how music playback should be affected when recording
              starts.</span
            >
          </label>
        </div>
      {/if}
    </div>
  {/if}
</div>
