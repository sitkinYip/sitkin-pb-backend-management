import { Authenticated, Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import {
  ThemedLayout,
  ThemedSider,
  useNotificationProvider,
} from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";
import "./styles/admin.css";

import routerProvider, {
  CatchAllNavigate,
  DocumentTitleHandler,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { App as AntdApp } from "antd";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { Header } from "./components/header";
import { Title } from "./components/title";
import { navigationResources } from "./components/navigation";
import { ColorModeContextProvider } from "./contexts/color-mode";
import { ContentPage } from "./game/ContentPages";
import { OperationPage } from "./game/OperationPages";
import { ResourceManager } from "./pages/resourceManager";
import { LoginRoute } from "./pages/login";
import { authProvider } from "./providers/auth";
import { ADMIN_HOME, ADMIN_LOGIN } from "./providers/admin-routing";
import { dataProvider } from "./providers/data";
import "./i18n";

function App() {
  const { t, i18n } = useTranslation();

  const i18nProvider = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translate: (key: string, params?: unknown) =>
      t(key, params as any) as string,
    changeLocale: (lang: string) => i18n.changeLanguage(lang),
    getLocale: () => i18n.language,
  };

  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <AntdApp>
            <Refine
              dataProvider={dataProvider}
              notificationProvider={useNotificationProvider}
              routerProvider={routerProvider}
              authProvider={authProvider}
              i18nProvider={i18nProvider}
              resources={navigationResources}
              options={{
                syncWithLocation: true,
                warnWhenUnsavedChanges: true,
                projectId: "nPH8aP-lBMaHM-vDDgNK",
              }}
            >
              <Routes>
                <Route
                  element={
                    <Authenticated
                      key="authenticated-inner"
                      fallback={<CatchAllNavigate to={ADMIN_LOGIN} />}
                    >
                      <div className="admin-shell">
                        <ThemedLayout
                          Header={Header}
                          Sider={(props) => (
                            <ThemedSider {...props} fixed Title={Title} />
                          )}
                        >
                          <div className="admin-workspace">
                            <Outlet />
                          </div>
                        </ThemedLayout>
                      </div>
                    </Authenticated>
                  }
                >
                  <Route index element={<Navigate to={ADMIN_HOME} replace />} />
                  {(
                    ["questions", "sessions", "rewards", "narratives"] as const
                  ).map((section) => (
                    <Route
                      key={section}
                      path={`/${section}`}
                      element={<ContentPage section={section} />}
                    />
                  ))}
                  {(
                    [
                      "players",
                      "dispatch",
                      "progress",
                      "grants",
                      "notifications",
                      "ranks",
                      "audit",
                    ] as const
                  ).map((section) => (
                    <Route
                      key={section}
                      path={`/${section}`}
                      element={<OperationPage section={section} />}
                    />
                  ))}
                  <Route
                    path="/resource_manager"
                    element={<ResourceManager />}
                  />
                  <Route
                    path="*"
                    element={<Navigate to={ADMIN_HOME} replace />}
                  />
                </Route>
                <Route
                  element={
                    <Authenticated
                      key="authenticated-outer"
                      fallback={<Outlet />}
                    >
                      <Navigate to={ADMIN_HOME} replace />
                    </Authenticated>
                  }
                >
                  <Route path={ADMIN_LOGIN} element={<LoginRoute />} />
                </Route>
              </Routes>

              <RefineKbar />
              <UnsavedChangesNotifier />
              <DocumentTitleHandler />
            </Refine>
          </AntdApp>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
