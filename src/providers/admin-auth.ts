import type { AuthProvider } from "@refinedev/core";
import type PocketBase from "pocketbase";
import { ADMIN_HOME, ADMIN_LOGIN } from "./admin-routing.ts";

export function createAdminAuthProvider(pb: PocketBase): AuthProvider {
  return {
    login: async ({ account, password }) => {
      try {
        if (typeof account !== "string" || !account.trim())
          throw new Error("请输入管理员账号");
        await pb
          .collection("game_admins")
          .authWithPassword(account.trim().toLowerCase(), password);
        await pb.send("/api/questions/v1/admin/me", {
          method: "GET",
          requestKey: null,
        });
        return {
          success: true,
          redirectTo: ADMIN_HOME,
        };
      } catch (error) {
        pb.authStore.clear();
        const err = error as Error;
        return {
          success: false,
          error: {
            name: "LoginError",
            message: err.message || "账号或密码错误",
          },
        };
      }
    },
    logout: async () => {
      pb.authStore.clear();
      return {
        success: true,
        redirectTo: ADMIN_LOGIN,
      };
    },
    check: async () => {
      if (
        pb.authStore.isValid &&
        pb.authStore.record?.collectionName === "game_admins"
      ) {
        try {
          await pb.send("/api/questions/v1/admin/me", {
            method: "GET",
            requestKey: null,
          });
          return { authenticated: true };
        } catch {
          pb.authStore.clear();
        }
      }

      return {
        authenticated: false,
        redirectTo: ADMIN_LOGIN,
      };
    },
    getPermissions: async () => null,
    getIdentity: async () => {
      if (pb.authStore.isValid && pb.authStore.model) {
        return {
          ...pb.authStore.model,
          name: pb.authStore.model.displayName || pb.authStore.model.account,
          avatar: pb.authStore.model.avatar
            ? pb.files.getUrl(pb.authStore.model, pb.authStore.model.avatar)
            : undefined,
        };
      }
      return null;
    },
    onError: async (error) => {
      if (error.statusCode === 401 || error.status === 401)
        return { logout: true, redirectTo: ADMIN_LOGIN, error };
      return { error };
    },
  };
}
