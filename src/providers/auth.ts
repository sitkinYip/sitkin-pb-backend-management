import type { AuthProvider } from "@refinedev/core";
import { pb } from "../pocketbase";

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    try {
      await pb.collection("users").authWithPassword(email, password);
      return {
        success: true,
        redirectTo: "/",
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        error: {
          name: "LoginError",
          message: err.message || "Invalid email or password",
        },
      };
    }
  },
  logout: async () => {
    pb.authStore.clear();
    return {
      success: true,
      redirectTo: "/login",
    };
  },
  check: async () => {
    if (pb.authStore.isValid) {
      return {
        authenticated: true,
      };
    }

    return {
      authenticated: false,
      redirectTo: "/login",
    };
  },
  getPermissions: async () => null,
  getIdentity: async () => {
    if (pb.authStore.isValid && pb.authStore.model) {
      return {
        ...pb.authStore.model,
        name: pb.authStore.model.name || pb.authStore.model.email,
        avatar: pb.authStore.model.avatar
          ? pb.files.getUrl(pb.authStore.model, pb.authStore.model.avatar)
          : undefined,
      };
    }
    return null;
  },
  onError: async (error) => {
    console.error(error);
    return { error };
  },
};
