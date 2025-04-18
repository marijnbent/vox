<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable, get } from "svelte/store";

  const logLines = writable<string[]>([]);
  const isLoading = writable(true);
  const isLiveUpdating = writable(false);
  const maxLines = writable(500);

  let unsubscribeLogs: (() => void) | null = null;

  onMount(async () => {
    isLoading.set(true);
    try {
      const initialLogs = await window.api.getLogLines(get(maxLines));
      logLines.set(initialLogs);
      window.api.log('info', `Logs component mounted, loaded ${initialLogs.length} lines.`);
    } catch (error) {
      window.api.log('error', 'Failed to load initial logs:', error);
      logLines.set(['Error loading logs.']);
    } finally {
      isLoading.set(false);
    }
  });

  onDestroy(() => {
    if (unsubscribeLogs) {
      unsubscribeLogs();
      unsubscribeLogs = null;
      window.api.log('info', 'Unsubscribed from live log updates.');
      window.api.unsubscribeLogUpdates();
    }
  });

  function toggleLiveUpdates() {
    const currentlyLive = get(isLiveUpdating);
    isLiveUpdating.set(!currentlyLive);

    if (!currentlyLive) {
      window.api.log('info', 'Subscribing to live log updates...');
      unsubscribeLogs = window.api.onLogUpdate((newLine) => {
        logLines.update(lines => [...lines, newLine].slice(-get(maxLines)));
      });
      window.api.subscribeLogUpdates();
    } else {
      if (unsubscribeLogs) {
        unsubscribeLogs();
        unsubscribeLogs = null;
        window.api.log('info', 'Unsubscribed from live log updates.');
        window.api.unsubscribeLogUpdates();
      }
    }
  }

  async function refreshLogs() {
     isLoading.set(true);
     try {
       const refreshedLogs = await window.api.getLogLines(get(maxLines));
       logLines.set(refreshedLogs);
       window.api.log('info', `Refreshed logs, loaded ${refreshedLogs.length} lines.`);
     } catch (error) {
       window.api.log('error', 'Failed to refresh logs:', error);
       logLines.set(['Error refreshing logs.']);
     } finally {
       isLoading.set(false);
     }
  }

</script>

<div class="p-4 space-y-4">
  <h2 class="text-xl font-semibold">Application Logs</h2>

  <div class="flex items-center space-x-4">
     <button class="btn btn-sm" class:btn-primary={$isLiveUpdating} on:click={toggleLiveUpdates}>
       {#if $isLiveUpdating} Stop Live Updates {:else} Start Live Updates {/if}
     </button>
     <button class="btn btn-sm btn-secondary" on:click={refreshLogs} disabled={$isLoading || $isLiveUpdating}>
        Refresh
     </button>
  </div>

  <div class="bg-base-200 p-4 rounded-md font-mono text-xs overflow-auto h-96">
    {#if $isLoading}
      <p>Loading logs...</p>
    {:else}
      <pre>{$logLines.join('\n')}</pre>
    {/if}
  </div>
</div>