<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable, get } from "svelte/store";

  const logLines = writable<string[]>([]);
  const isLoading = writable(true);
  const maxLines = writable(500);
  const copied = writable(false);
  let copyTimeout: ReturnType<typeof setTimeout>;

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
    clearTimeout(copyTimeout); // Clear timeout on component destroy
  });

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

  async function copyLogs() {
    try {
      const logsText = get(logLines).join('\n');
      await navigator.clipboard.writeText(logsText);
      copied.set(true);
      window.api.log('info', 'Copied logs to clipboard.');
      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => copied.set(false), 2000);
    } catch (error) {
      window.api.log('error', 'Failed to copy logs to clipboard:', error);
    }
  }

</script>

<div class="p-4 space-y-4">
  <h2 class="text-xl font-semibold">Application Logs</h2>

  <div class="flex items-center space-x-4">
     <button class="btn btn-sm btn-secondary" on:click={refreshLogs} disabled={$isLoading}>
        Refresh
     </button>
     <button class="btn btn-sm" on:click={copyLogs} disabled={$isLoading || $logLines.length === 0}>
        {#if $copied} Copied! {:else} Copy {/if}
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