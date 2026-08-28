import PocketBase, { LocalAuthStore } from "pocketbase";

export const pb = new PocketBase(
  import.meta.env.VITE_POCKET_BASE_HOST || "https://api.sitkin.top",
  new LocalAuthStore("questions-admin:v1:auth"),
);
