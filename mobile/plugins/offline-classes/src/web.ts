import { WebPlugin } from "@capacitor/core";
import type { OfflineClassesPlugin } from "./definitions";

// Offline download/decrypt is a NATIVE feature only. In a plain browser we throw
// so the website falls back to "open the app" (same as the desktop behaviour).
export class OfflineClassesWeb extends WebPlugin implements OfflineClassesPlugin {
  async download(): Promise<{ path: string }> {
    throw this.unimplemented("Offline download is only available in the app.");
  }
  async isDownloaded(): Promise<{ value: boolean }> {
    return { value: false };
  }
  async decrypt(): Promise<{ path: string }> {
    throw this.unimplemented("Offline playback is only available in the app.");
  }
  async remove(): Promise<void> {
    /* no-op on web */
  }
}
