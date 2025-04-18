<script lang="ts">
  type Status = 'idle' | 'recording' | 'processing';

  export let status: Status = 'idle';
  export let size: string = '3rem';
  export let idleBorderColor: string = 'rgba(148, 163, 184, 0.3)';
  export let activeColor: string = '#33cfff';
  export let spinnerBorderWidth: string = '3px';
  export let waveDuration1: string = '4s';
  export let waveDuration2: string = '6s';
  export let waveDuration3: string = '10s';

  $: waveAnimationState = status === 'recording' ? 'running' : 'paused';

  $: containerStyle = `
    --size: ${size};
    --idle-border-color: ${idleBorderColor};
    --active-color: ${activeColor};
    --spinner-border-width: ${spinnerBorderWidth};
    --wave-anim-duration-1: ${waveDuration1};
    --wave-anim-duration-2: ${waveDuration2};
    --wave-anim-duration-3: ${waveDuration3};
  `;

</script>

<div
  class="status-indicator-container {status}"
  style={containerStyle}
  role="status"
  aria-live="polite"
  aria-label={status === 'processing' ? 'Processing' : (status === 'recording' ? 'Recording active' : 'Idle')}
>
  <div class="water-wave water-wave1" style="animation-play-state: {waveAnimationState};"></div>
  <div class="water-wave water-wave2" style="animation-play-state: {waveAnimationState};"></div>
  <div class="water-wave water-wave3" style="animation-play-state: {waveAnimationState};"></div>
</div>

<style>
  .status-indicator-container {
    position: relative;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    box-sizing: border-box;
    overflow: hidden;
    border: var(--spinner-border-width) solid transparent;
    transition: border-color 0.3s ease-in-out;
  }

  .status-indicator-container.idle {
    border-color: var(--idle-border-color);
  }
  .status-indicator-container.idle .water-wave {
    opacity: 0.6;
    transform: scale(1);
  }

  .status-indicator-container.recording {
    border-color: var(--idle-border-color);
  }
  .status-indicator-container.recording .water-wave {
    opacity: 1;
    transform: scale(1);
  }

  .status-indicator-container.processing {
    border-color: color-mix(in srgb, var(--active-color) 15%, transparent);
    border-left-color: var(--active-color);
    animation: spin 1s linear infinite;
  }
  .status-indicator-container.processing .water-wave {
    opacity: 0;
    transform: scale(0.8);
  }

  .water-wave {
    position: absolute;
    width: 200%;
    height: 200%;
    border-radius: 40%;
    background-color: var(--active-color);
    animation-name: water-waves;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
    opacity: 0;
    transform: scale(1);
    transition: opacity 0.4s ease-in-out, transform 0.4s ease-in-out;
    animation-play-state: paused;
  }

  .water-wave1 {
    top: 40%;
    left: -25%;
    opacity: 0.7;
    border-radius: 40%;
    animation-duration: var(--wave-anim-duration-1);
  }

  .water-wave2 {
    top: 45%;
    left: -35%;
    opacity: 0.5;
    border-radius: 35%;
    animation-duration: var(--wave-anim-duration-2);
  }

  .water-wave3 {
    top: 50%;
    left: -35%;
    opacity: 0.3;
    border-radius: 33%;
    animation-duration: var(--wave-anim-duration-3);
  }

  @keyframes water-waves {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>