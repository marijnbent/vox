interface MusicState {
  isPlaying: boolean;
  volume: number | null;
}

let originalMusicState: MusicState | null = null;
const LOWERED_VOLUME_PERCENTAGE = 0.2;

export const manageMusicOnRecordStart = async (
  action: "none" | "pause" | "lowerVolume",
): Promise<void> => {
  if (action === "none") {
    return;
  }

  let currentVolume: number | null = null;
  let successfullyManaged = false;

  if (action === "lowerVolume") {
    try {
      currentVolume = await window.api.getSystemVolume();
      if (currentVolume === null) {
        window.api.log("warn", "[MediaManager] Could not get current system volume to lower it.");
        return;
      }
    } catch (error) {
      window.api.log("error", "[MediaManager] Error getting system volume:", error);
      throw error;
    }
  }

  originalMusicState = {
    isPlaying: true,
    volume: currentVolume,
  };

  if (action === "pause") {
    if (typeof window.api.controlMusic !== 'function') {
      window.api.log("warn", "[MediaManager] controlMusic function not available on window.api. Cannot pause music.");
      return;
    }
    try {
      await window.api.controlMusic("pause");
      window.api.log("info", "[MediaManager] Sent 'pause' command to music applications.");
      successfullyManaged = true;
    } catch (error) {
      window.api.log("error", "[MediaManager] Error sending 'pause' command:", error);
      throw error;
    }
  } else if (action === "lowerVolume" && originalMusicState.volume !== null) {
    try {
      const targetVolume = LOWERED_VOLUME_PERCENTAGE * currentVolume;
      await window.api.setSystemVolume(targetVolume);
      window.api.log(
        "info",
        `[MediaManager] System volume lowered to ${targetVolume}%. Original: ${originalMusicState.volume}%`,
      );
      successfullyManaged = true;
    } catch (error) {
      window.api.log("error", "[MediaManager] Error lowering system volume:", error);
      originalMusicState.volume = null;
      throw error;
    }
  }
  
  if (!successfullyManaged) { 
    originalMusicState = null;
  }
};

export const restoreMusicAfterRecordStop = async (): Promise<void> => {
  if (!originalMusicState) {
    return;
  }

  const { isPlaying, volume } = originalMusicState;
  if (volume !== null) {
    if (typeof window.api.setSystemVolume !== 'function') {
      window.api.log("warn", "[MediaManager] setSystemVolume function not available on window.api. Cannot restore volume.");
    } else {
      try {
        await window.api.setSystemVolume(volume);
        window.api.log("info", `[MediaManager] System volume restored to ${volume}%.`);
      } catch (error) {
        window.api.log("error", "[MediaManager] Error restoring system volume:", error);
      }
    }
  }

  const transcriptionSettings = await window.api.getStoreValue("transcription") as any || {};
  const lastAction = transcriptionSettings.musicManagementAction;

  if (lastAction === "pause" && isPlaying) {
    if (typeof window.api.controlMusic !== 'function') {
      window.api.log("warn", "[MediaManager] controlMusic function not available on window.api. Cannot resume music.");
    } else {
      try {
        await window.api.controlMusic("play");
        window.api.log("info", "[MediaManager] Sent 'play' command to music applications to resume.");
      } catch (error) {
        window.api.log("error", "[MediaManager] Error sending 'play' command:", error);
      }
    }
  }
  originalMusicState = null;
};