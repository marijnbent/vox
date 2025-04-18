<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { fade } from 'svelte/transition';
  import WaterWaveAnimation from './components/WaterWaveAnimation.svelte';

  type OverallStatus = 'idle' | 'recording' | 'processing' | 'error';
  type WidgetDisplayState = 'idle' | 'initializing' | 'recording' | 'processing' | 'error';

  const widgetDisplayState = writable<WidgetDisplayState>('idle');
  let currentDisplayState: WidgetDisplayState = 'idle';

  let recorderActuallyStarted = false;
  let currentOverallStatus: OverallStatus = 'idle';

  let visible = false;
  let elapsedTime = 0;
  let timer: NodeJS.Timeout | undefined = undefined;

  let cleanupStatusListener: (() => void) | null = null;
  let cleanupRecorderStartedListener: (() => void) | null = null;

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      elapsedTime += 1;
    }, 1000);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
      elapsedTime = 0;
    }
  }

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  onMount(() => {
    const unsubscribeDisplayState = widgetDisplayState.subscribe((newState) => {
      currentDisplayState = newState;
      visible = ['recording', 'processing'].includes(newState);
    });

    cleanupStatusListener = window.widgetApi.onStatusUpdate((newStatus: OverallStatus) => {
      currentOverallStatus = newStatus;

      switch (newStatus) {
        case 'recording':
          if (!recorderActuallyStarted) {
            widgetDisplayState.set('initializing');
            if (timer) stopTimer();
          } else {
            widgetDisplayState.set('recording');
            if (!timer) startTimer();
          }
          break;
        case 'processing':
          stopTimer();
          recorderActuallyStarted = false;
          widgetDisplayState.set('processing');
          break;
        case 'idle':
        case 'error':
          stopTimer();
          recorderActuallyStarted = false;
          widgetDisplayState.set(newStatus === 'error' ? 'error' : 'idle');
          break;
      }
    });

    cleanupRecorderStartedListener = window.widgetApi.onRecorderStarted(() => {
      recorderActuallyStarted = true;
      if (currentOverallStatus === 'recording') {
        widgetDisplayState.set('recording');
        startTimer();
      }
    });

    return () => {
      stopTimer();
      unsubscribeDisplayState();
      cleanupStatusListener?.();
      cleanupRecorderStartedListener?.();
    };
  });

  onDestroy(() => {
    stopTimer();
  });
</script>

{#if visible}
<div
  class="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50"
  transition:fade={{ duration: 150 }}
>
  <div class="flex items-center bg-black/85 backdrop-blur-md rounded-full py-1.5 px-4 shadow-lg border border-gray-600/30 gap-2">
    <div>
      <WaterWaveAnimation
        status={currentDisplayState === 'error' ? 'idle' : currentDisplayState}
        size="1.5rem"
        borderColor="rgba(148, 163, 184, 0.3)"
      />
    </div>

    <div class="text-xs text-gray-200 font-medium w-20 text-center flex items-center justify-center h-[1.5rem]">
      {#if currentDisplayState === 'recording'}
        <span class="tabular-nums">{formatTime(elapsedTime)}</span>
      {:else if currentDisplayState === 'processing'}
        <div class="flex space-x-1 justify-center items-center">
          <span class="sr-only">Loading...</span>
          <div class='h-1 w-1 bg-gray-300 rounded-full animate-bounce [animation-delay:-0.3s]'></div>
          <div class='h-1 w-1 bg-gray-300 rounded-full animate-bounce [animation-delay:-0.15s]'></div>
          <div class='h-1 w-1 bg-gray-300 rounded-full animate-bounce'></div>
        </div>
      {:else if currentDisplayState === 'error'}
        Error
      {/if}
    </div>
  </div>
</div>
{/if}