<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable } from "svelte/store";

  const historyData = writable<PaginatedHistory | null>(null);
  const selectedEntry = writable<HistoryRecord | null>(null);
  const isLoading = writable(true);
  const error = writable<string | null>(null);

  const DEFAULT_PAGE_SIZE = 6;

  async function fetchHistory(
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  ): Promise<void> {
    isLoading.set(true);
    error.set(null);
    selectedEntry.set(null);
    try {
      const data = await window.api.getHistory(page, pageSize);
      if (data) {
        console.log(data);
        historyData.set(data);
      } else {
        historyData.set({
          entries: [],
          totalEntries: 0,
          totalPages: 0,
          currentPage: 1,
        });
        error.set("Failed to load history data.");
      }
      window.api.log("info", `History page ${page} loaded.`);
    } catch (err) {
      window.api.log("error", "Error fetching history:", err);
      error.set(`Error loading history: ${err.message}`);
      historyData.set({
        entries: [],
        totalEntries: 0,
        totalPages: 0,
        currentPage: 1,
      }); // Set empty state on error
    } finally {
      isLoading.set(false);
    }
  }

  async function deleteEntry(id: string): Promise<void> {
    if (!confirm("Are you sure you want to delete this history entry?")) return;
    try {
      const success = await window.api.deleteHistoryEntry(id);
      if (success) {
        window.api.log("info", `History entry ${id} deleted.`);
        // Refresh current page
        fetchHistory($historyData?.currentPage || 1);
      } else {
        error.set("Failed to delete entry.");
      }
    } catch (err) {
      window.api.log("error", `Error deleting history entry ${id}:`, err);
      error.set(`Error deleting entry: ${err.message}`);
    }
  }

  async function clearAll(): Promise<void> {
    if (
      !confirm(
        "Are you sure you want to delete ALL history entries? This cannot be undone.",
      )
    )
      return;
    try {
      const success = await window.api.clearAllHistory();
      if (success) {
        window.api.log("info", "All history cleared.");
        fetchHistory(1); // Refresh to show empty list
      } else {
        error.set("Failed to clear history.");
      }
    } catch (err) {
      window.api.log("error", "Error clearing history:", err);
      error.set(`Error clearing history: ${err.message}`);
    }
  }

  function selectEntry(entry: HistoryRecord): void {
    selectedEntry.set(entry);
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function truncateText(text: string, maxLength = 100): string {
    if (!text) return "";
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  }

  onMount(() => {
    fetchHistory();

    const cleanupResultListener = window.api.onTranscriptionResult(() => {
      window.api.log(
        "info",
        "History page received transcription result, refreshing list.",
      );
      fetchHistory(1); // Fetch the first page
    });

    onDestroy(() => {
      cleanupResultListener();
    });
  });
</script>

<div class="p-4 space-y-6">
  <div class="flex justify-between items-center">
    <h2 class="text-xl font-semibold">Latest Transcriptions</h2>
    {#if $historyData && $historyData.totalEntries > 0}
      <button
        class="btn btn-sm btn-outline btn-error"
        on:click={clearAll}
        disabled={$isLoading}
      >
        Clear All History
      </button>
    {/if}
  </div>

  {#if $isLoading}
    <div class="text-center p-10">
      <span class="loading loading-lg loading-spinner"></span>
      <p>Loading History...</p>
    </div>
  {:else if $error}
    <div class="alert alert-error">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="stroke-current shrink-0 h-6 w-6"
        fill="none"
        viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2 2m2-2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        /></svg
      >
      <span>{$error}</span>
    </div>
  {:else if $historyData && $historyData.entries.length > 0}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Entry List -->
      <div class="md:col-span-1 space-y-2 overflow-y-auto pr-2">
        {#each $historyData.entries as entry (entry.id)}
          <div
            class="p-3 rounded-md border cursor-pointer transition-colors"
            class:border-primary={$selectedEntry?.id === entry.id}
            class:bg-base-200={$selectedEntry?.id === entry.id}
            class:border-base-300={$selectedEntry?.id !== entry.id}
            class:hover:bg-base-200={$selectedEntry?.id !== entry.id}
            on:click={() => selectEntry(entry)}
            role="button"
            tabindex="0"
            on:keypress={(e) => {
              if (e.key === "Enter") selectEntry(entry);
            }}
          >
            <p class="text-sm font-medium truncate" title={entry.originalText}>
              {truncateText(entry.originalText)}
            </p>
            <p class="text-xs opacity-60 mt-1">
              {formatTimestamp(entry.timestamp)}
            </p>
            {#if entry.enhancedText}
              <span class="badge badge-outline badge-primary badge-xs">Enhanced</span>
            {/if}
          </div>
        {/each}

        <!-- Pagination -->
        {#if $historyData.totalPages > 1}
          <div class="join mt-4 flex justify-center">
            <button
              class="join-item btn btn-sm"
              disabled={$historyData.currentPage <= 1}
              on:click={() => fetchHistory($historyData.currentPage - 1)}
              >«</button
            >
            <button class="join-item btn btn-sm"
              >Page {$historyData.currentPage} / {$historyData.totalPages}</button
            >
            <button
              class="join-item btn btn-sm"
              disabled={$historyData.currentPage >= $historyData.totalPages}
              on:click={() => fetchHistory($historyData.currentPage + 1)}
              >»</button
            >
          </div>
        {/if}
      </div>

      <!-- Entry Details -->
      <div class="md:col-span-2">
        {#if $selectedEntry}
          <div class="card bg-base-100 border border-base-300">
            <div class="card-body">
              <div class="flex justify-between items-start mb-4">
                <h3 class="card-title text-lg">Details</h3>
                <button
                  class="btn btn-xs btn-ghost text-error"
                  title="Delete Entry"
                  on:click|stopPropagation={() =>
                    deleteEntry($selectedEntry!.id)}
                >
                  <i class="ri-delete-bin-line"></i> Delete
                </button>
              </div>

              <p class="text-xs opacity-60 mb-4">
                Recorded: {formatTimestamp($selectedEntry.timestamp)}
              </p>

              <div class="space-y-4">
                <div>
                  <h4 class="font-semibold mb-1">Original Transcription</h4>
                  <div
                    class="bg-base-200 p-3 rounded text-sm whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
                  >
                    {$selectedEntry.originalText || "(empty)"}
                  </div>
                </div>

                {#if $selectedEntry.promptDetails.length > 0}
                  <div>
                    <h4 class="font-semibold mb-1">Prompt Details</h4>
                    {#each $selectedEntry.promptDetails as detail}
                      <details class="mb-2">
                        <summary class="bg-base-200 p-3 rounded cursor-pointer">
                          {detail.promptName}
                        </summary>
                        <div class="bg-base-100 p-3 text-sm whitespace-pre-wrap break-words mt-2">
                          <p><strong>Rendered Prompt:</strong></p>
                          <pre class="text-xs whitespace-pre-wrap break-words overflow-y-auto">{detail.renderedPrompt}</pre>
                          <p><strong>Enhanced Text:</strong></p>
                          <pre class="text-xs whitespace-pre-wrap break-words overflow-y-auto">{detail.enhancedText}</pre>
                        </div>
                      </details>
                    {/each}
                  </div>
                {/if}

                {#if $selectedEntry.enhancedText}
                  <div>
                    <h4 class="font-semibold mb-1">Enhanced Text</h4>
                    <div
                      class="bg-success/10 p-3 rounded text-sm whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
                    >
                      {$selectedEntry.enhancedText}
                    </div>

                  </div>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div
            class="flex items-center justify-center h-full bg-base-200 rounded-md p-10"
          >
            <p class="opacity-60">
              Select an entry from the list to view details.
            </p>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="text-center p-10 bg-base-200 rounded-md">
      <p class="opacity-60">No transcription history found.</p>
      <p class="text-sm mt-1 opacity-50">
        Recordings will appear here after they are transcribed.
      </p>
    </div>
  {/if}
</div>
