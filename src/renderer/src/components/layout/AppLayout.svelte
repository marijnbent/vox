<script lang="ts">
  import StatusIndicator from './StatusIndicator.svelte';

  export let activePage = 'dashboard';

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard-3' },
    { id: 'shortcuts', label: 'Shortcuts', icon: 'command' },
    { id: 'transcription', label: 'Transcription', icon: 'mic' },
    { id: 'enhancements', label: 'Enhancements', icon: 'sparkling' },
    { id: 'dictionary', label: 'Dictionary', icon: 'book' },
    { id: 'permissions', label: 'Permissions', icon: 'shield-check' },
    { id: 'history', label: 'History', icon: 'time' },
    { id: 'logs', label: 'Logs', icon: 'file-warning' },
  ];
</script>

<div class="flex min-h-screen">
  <aside class="bg-purple-50 w-64 h-screen flex flex-col sticky top-0">
    <div class="px-4 py-6">
      <h1 class="text-2xl font-bold">🎤✨</h1>
    </div>

    <ul class="menu menu-lg p-2 pt-0 flex-1 overflow-y-auto">
      {#each navItems as item}
        <li>
          <a
            href="#{item.id}"
            class="{activePage === item.id ? 'active' : ''}"
            on:click={(): void => { activePage = item.id; }}
          >
            <span class="flex items-center text-base">
              <i class="ri-{item.icon}-line mr-3"></i>
              {item.label}
            </span>
          </a>
        </li>
      {/each}
    </ul>

    <div class="mt-auto mb-0">
      <StatusIndicator />
    </div>

    <div class="p-4 text-xs opacity-70">
      <p>Vox Transcriber v1.0.0</p>
    </div>
  </aside>

  <main class="flex-1 overflow-y-auto">
    <div class="p-4 md:p-6">
      <slot />
    </div>
  </main>
</div>