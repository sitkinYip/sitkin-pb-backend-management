import { pb } from "../pocketbase";
import { createAdminAuthProvider } from "./admin-auth";

export const authProvider = createAdminAuthProvider(pb);
