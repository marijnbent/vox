<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import AppLayout from "./components/layout/AppLayout.svelte";
  import Dashboard from "./components/settings/Dashboard.svelte";
  import Logs from "./components/settings/Logs.svelte";
  import Dictionary from "./components/settings/Dictionary.svelte";
  import History from "./components/settings/History.svelte";
  import Enhancements from "./components/settings/Enhancements.svelte";
  import Permissions from "./components/settings/Permissions.svelte";
  import Shortcuts from "./components/settings/Shortcuts.svelte";
  import Transcription from "./components/settings/Transcription.svelte";
  import { initializeAudioRecorder } from "./lib/audioRecorder";

  let activePage = "dashboard";

  let cleanupAudioRecorder: (() => void) | null = null;

  onMount(() => {
    cleanupAudioRecorder = initializeAudioRecorder();
  });

  onDestroy(() => {
    if (cleanupAudioRecorder) {
      cleanupAudioRecorder();
    }
  });
</script>

<AppLayout bind:activePage>
  {#if activePage === "dashboard"}
    <Dashboard />
  {:else if activePage === "shortcuts"}
    <Shortcuts />
  {:else if activePage === "transcription"}
    <Transcription />
  {:else if activePage === "enhancements"}
    <Enhancements />
  {:else if activePage === "dictionary"}
    <Dictionary />
  {:else if activePage === "permissions"}
    <Permissions />
  {:else if activePage === "history"}
    <History />
  {:else if activePage === "logs"}
    <Logs />
  {/if}
</AppLayout>
