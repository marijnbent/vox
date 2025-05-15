import { writable, get, derived } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import type { EnhancementSettings, EnhancementPrompt as StoreEnhancementPrompt } from "../../../main/store";

// Interface for the new system default prompts (fetched from backend)
export interface SystemPrompt {
  id: string;
  name: string;
  template: string;
  temperature: number;
  isFallback?: boolean;
}

export type DisplayablePrompt = StoreEnhancementPrompt | SystemPrompt;

export const DEFAULT_CLEAN_TRANSCRIPTION_ID = "default_clean_transcription";
export const DEFAULT_CONTEXTUAL_FORMATTING_ID = "default_contextual_formatting";
export const SYSTEM_DEFAULT_PROMPT_IDS = new Set([
  DEFAULT_CLEAN_TRANSCRIPTION_ID,
  DEFAULT_CONTEXTUAL_FORMATTING_ID,
]);

export const FALLBACK_CUSTOM_PROMPT_TEMPERATURE = 0.7; // For custom prompts if not set

export const customPrompts = writable<StoreEnhancementPrompt[]>([]); // Stores only custom prompts
export const systemPromptCache = writable<Record<string, SystemPrompt>>({}); // Cache for default prompt details

// Create a new derived store for all prompts, suitable for Multiselect and general listing
export const allPrompts = derived(
  [customPrompts, systemPromptCache],
  ([$customPrompts, $systemPromptsCache]) => {
    const systemDefaults = Array.from(SYSTEM_DEFAULT_PROMPT_IDS)
      .map(id => $systemPromptsCache[id])
      .filter(p => p) as SystemPrompt[];
    
    const all: DisplayablePrompt[] = [...systemDefaults, ...$customPrompts.map(p => ({
      ...p,
      temperature: p.temperature ?? FALLBACK_CUSTOM_PROMPT_TEMPERATURE
    }))];
    
    // Ensure unique prompts by ID, prioritizing system defaults if IDs were to clash (unlikely)
    const uniquePrompts = new Map<string, DisplayablePrompt>();
    all.forEach(p => {
      if (!uniquePrompts.has(p.id)) {
        uniquePrompts.set(p.id, p);
      }
    });
    return Array.from(uniquePrompts.values());
  }
);

export async function initializePrompts(settingsStore: ReturnType<typeof writable<EnhancementSettings>>) {
  try {
    const storedPromptsPromise = window.api.getStoreValue("enhancementPrompts") as Promise<Partial<StoreEnhancementPrompt>[] | undefined>;
    
    const defaultPromptDetailPromises = Array.from(SYSTEM_DEFAULT_PROMPT_IDS).map(id =>
      window.api.getDefaultPromptDetails(id).catch(err => {
        window.api.log("error", `Failed to fetch details for default prompt ${id} on mount:`, err);
        return null; // Allow Promise.all to complete
      })
    );

    const [storedPromptsResult, ...fetchedDefaultDetails] =
      await Promise.all([
        storedPromptsPromise,
        ...defaultPromptDetailPromises
      ]);

    // Populate systemPromptCache
    fetchedDefaultDetails.forEach(details => {
      if (details) {
        systemPromptCache.update(cache => ({ ...cache, [details.id]: details as SystemPrompt }));
      }
    });

    if (storedPromptsResult) {
      const migratedPrompts = storedPromptsResult
        .filter((p) => p?.id && p.name && p.template) // Basic validation
        .map((p) => ({
          id: p!.id!,
          name: p!.name!,
          template: p!.template!,
          temperature: p?.temperature ?? FALLBACK_CUSTOM_PROMPT_TEMPERATURE,
        }));
      customPrompts.set(migratedPrompts as StoreEnhancementPrompt[]);
    } else {
      customPrompts.set([]);
    }
  } catch (error) {
    window.api.log("error", "Failed to load enhancement prompts:", error);
    customPrompts.set([]);
  }
}

export async function addPrompt(name: string, template: string, temperature: number) {
  const newPrompt: StoreEnhancementPrompt = {
    id: uuidv4(),
    name: name.trim(),
    template: template.trim(),
    temperature,
  };
  const currentCustoms = get(customPrompts);
  const updatedCustoms = [...currentCustoms, newPrompt];
  try {
    await window.api.setStoreValue("enhancementPrompts", updatedCustoms);
    customPrompts.set(updatedCustoms);
    window.api.log("info", "New prompt saved:", newPrompt.id);
  } catch (error) {
    window.api.log("error", "Failed to save new prompt:", error);
    alert("Failed to save the new prompt.");
    throw error; // Re-throw to allow UI to handle
  }
}

export async function editPrompt(id: string, name: string, template: string, temperature: number) {
  if (SYSTEM_DEFAULT_PROMPT_IDS.has(id)) {
    window.api.log("warn", `Attempted to edit system default prompt ID: ${id}. This is not allowed.`);
    alert("System default prompts cannot be edited.");
    return;
  }
  const updatedPrompt: StoreEnhancementPrompt = {
    id,
    name: name.trim(),
    template: template.trim(),
    temperature,
  };
  const currentCustoms = get(customPrompts);
  const updatedCustoms = currentCustoms.map((p) =>
    p.id === updatedPrompt.id ? updatedPrompt : p,
  );
  try {
    await window.api.setStoreValue("enhancementPrompts", updatedCustoms);
    customPrompts.set(updatedCustoms);
    window.api.log("info", "Prompt updated:", updatedPrompt.id);
  } catch (error) {
    window.api.log("error", "Failed to save updated prompt:", error);
    alert("Failed to save the updated prompt.");
    throw error; // Re-throw to allow UI to handle
  }
}

export async function deletePrompt(idToDelete: string, settingsStore: ReturnType<typeof writable<EnhancementSettings>>) {
  if (SYSTEM_DEFAULT_PROMPT_IDS.has(idToDelete)) {
    window.api.log("warn", `Attempted to delete system default prompt ID: ${idToDelete}. This is not allowed.`);
    return;
  }

  const currentCustoms = get(customPrompts);
  const updatedCustoms = currentCustoms.filter((p) => p.id !== idToDelete);
  
  const currentSettings = get(settingsStore);
  let updatedChain = currentSettings.activePromptChain.filter(
    (id) => id !== idToDelete,
  );

  if (updatedChain.length === 0) {
    updatedChain.push(DEFAULT_CLEAN_TRANSCRIPTION_ID, DEFAULT_CONTEXTUAL_FORMATTING_ID);
  }

  try {
    await Promise.all([
      window.api.setStoreValue("enhancementPrompts", updatedCustoms),
      window.api.setStoreValue("enhancements", {
        ...currentSettings,
        activePromptChain: updatedChain,
      }),
    ]);

    customPrompts.set(updatedCustoms);
    settingsStore.update((s) => ({ ...s, activePromptChain: updatedChain }));

    window.api.log(
      "info",
      `Deleted enhancement prompt ID: ${idToDelete} and updated chain.`,
    );
  } catch (error) {
    window.api.log("error", "Failed to delete prompt:", error);
    alert("Failed to delete the prompt.");
    throw error; // Re-throw to allow UI to handle
  }
}

// Re-export StoreEnhancementPrompt for convenience if needed by consumers
export type { StoreEnhancementPrompt };