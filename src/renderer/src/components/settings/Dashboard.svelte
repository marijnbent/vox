<script lang="ts">
  // Removed incorrect store import

  // Status is usually managed by the main process
  let status = {
    isRecording: false,
    isInitialized: true,
    transcriptionBackend: "Local Whisper",
    enhancementEnabled: false,
    lastTranscription: null as string | null
  };

  // Example transcriptions for demo
  const recentTranscriptions = [
    { text: "This is a test transcription to demonstrate the UI.", timestamp: Date.now() - 60000, enhanced: false },
    { text: "Vox transcriber is designed to help you convert speech to text quickly.", timestamp: Date.now() - 600000, enhanced: true }
  ];
</script>

<div class="p-4">
  <h2 class="text-2xl font-bold mb-6">Dashboard</h2>
  
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    <!-- Status Card -->
    <div class="card bg-base-100 shadow-md">
      <div class="card-body">
        <h3 class="card-title">System Status</h3>

        <div class="divider my-1"></div>
        
        <div class="grid grid-cols-2 gap-2">
          <div class="font-semibold">Recording:</div>
          <div class="flex items-center">
            <span class="{status.isRecording ? 'bg-red-500' : 'bg-gray-400'} rounded-full w-2 h-2 mr-2"></span>
            {status.isRecording ? 'Active' : 'Inactive'}
          </div>
          
          <div class="font-semibold">Whisper Engine:</div>
          <div class="flex items-center">
            <span class="{status.isInitialized ? 'bg-green-500' : 'bg-yellow-500'} rounded-full w-2 h-2 mr-2"></span>
            {status.isInitialized ? 'Ready' : 'Initializing...'}
          </div>
          
          <div class="font-semibold">Backend:</div>
          <div>{status.transcriptionBackend}</div>
          
          <div class="font-semibold">Enhancement:</div>
          <div>{status.enhancementEnabled ? 'Enabled' : 'Disabled'}</div>
        </div>
      </div>
    </div>
    
    <!-- Shortcuts Card -->
    <div class="card bg-base-100 shadow-md">
      <div class="card-body">
        <h3 class="card-title">Quick Actions</h3>
        <div class="divider my-1"></div>
        
        <div class="flex flex-col gap-3">
          <button class="btn btn-primary">Test Microphone</button>
          <button class="btn btn-secondary">Test Transcription</button>
          <button class="btn">Configure Permissions</button>
        </div>
      </div>
    </div>
    
    <!-- Recent Transcriptions -->
    <div class="card bg-base-100 shadow-md md:col-span-2">
      <div class="card-body">
        <h3 class="card-title">Recent Transcriptions</h3>
        <div class="divider my-1"></div>
        
        {#if recentTranscriptions.length > 0}
          <div class="flex flex-col gap-4">
            {#each recentTranscriptions as transcription}
              <div class="bg-base-200 p-3 rounded-lg">
                <p class="text-sm mb-2">{new Date(transcription.timestamp).toLocaleString()}</p>
                <p class="text-lg">{transcription.text}</p>
                {#if transcription.enhanced}
                  <span class="badge badge-accent mt-2">Enhanced</span>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-center py-4 text-base-content/70">No recent transcriptions</p>
        {/if}
        
        <div class="card-actions justify-end mt-2">
          <a href="#history" class="btn btn-sm btn-outline">View All History</a>
        </div>
      </div>
    </div>
  </div>
</div>