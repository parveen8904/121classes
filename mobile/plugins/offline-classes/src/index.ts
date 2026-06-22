import { registerPlugin } from "@capacitor/core";
import type { OfflineClassesPlugin } from "./definitions";

const OfflineClasses = registerPlugin<OfflineClassesPlugin>("OfflineClasses", {
  web: () => import("./web").then((m) => new m.OfflineClassesWeb()),
});

export * from "./definitions";
export { OfflineClasses };
