import type { PluginListenerHandle } from "@capacitor/core";

export interface OfflineClassesPlugin {
  /** Stream-download the encrypted class to app storage as <id>.enc. */
  download(options: { id: string; url: string; expectedSize?: number }): Promise<{ path: string }>;

  /** True if the encrypted file exists (and matches expectedSize, if given). */
  isDownloaded(options: { id: string; expectedSize?: number }): Promise<{ value: boolean }>;

  /**
   * Decrypt the downloaded <id>.enc (AES-256-CBC) to a temporary playable file
   * and return its path. Pass the per-play key from the server (never stored).
   */
  decrypt(options: { id: string; keyB64: string; ivB64?: string | null; alg?: string | null }): Promise<{ path: string }>;

  /** Delete a downloaded class. */
  remove(options: { id: string }): Promise<void>;

  /** Progress while downloading. */
  addListener(
    eventName: "downloadProgress",
    listenerFunc: (data: { id: string; received: number; total: number }) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}
