import { Authenticated, Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import {
  ErrorComponent,
  ThemedLayout,
  ThemedSider,
  useNotificationProvider,
} from "@refinedev/antd";
import "@refinedev/antd/dist/reset.css";

import routerProvider, {
  CatchAllNavigate,
  DocumentTitleHandler,
  NavigateToResource,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { App as AntdApp } from "antd";
import { BrowserRouter, Outlet, Route, Routes } from "react-router";
import { useTranslation } from "react-i18next";
import { Header } from "./components/header";
import { Title } from "./components/title";
import { ColorModeContextProvider } from "./contexts/color-mode";
import {
  LevelCreate,
  LevelEdit,
  LevelList,
  LevelShow,
} from "./pages/levels";
import {
  LetterCreate,
  LetterEdit,
  LetterList,
} from "./pages/letter";
import {
  PhraseCreate,
  PhraseEdit,
  PhraseList,
} from "./pages/phrase";
import { ForgotPassword } from "./pages/forgotPassword";
import { Login } from "./pages/login";
import { Register } from "./pages/register";
import { authProvider } from "./providers/auth";
import { dataProvider } from "./providers/data";
import "./i18n";


function App() {
  const { t, i18n } = useTranslation();

  const i18nProvider = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translate: (key: string, params?: unknown) => t(key, params as any) as string,
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
                resources={[
                  {
                    name: "levels",
                    list: "/levels",
                    create: "/levels/create",
                    edit: "/levels/edit/:id",
                    show: "/levels/show/:id",
                    meta: {
                      canDelete: true,
                    },
                  },
                  {
                    name: "letter",
                    list: "/letter",
                    create: "/letter/create",
                    edit: "/letter/edit/:id",
                    meta: {
                      canDelete: true,
                    },
                  },
                  {
                    name: "phrase",
                    list: "/phrase",
                    create: "/phrase/create",
                    edit: "/phrase/edit/:id",
                    meta: {
                      canDelete: true,
                    },
                  },
                ]}
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
                        fallback={<CatchAllNavigate to="/login" />}
                      >
                        <ThemedLayout
                          Header={Header}
                          Sider={(props) => <ThemedSider {...props} fixed Title={Title} />}
                        >
                          <Outlet />
                        </ThemedLayout>
                      </Authenticated>
                    }
                  >
                    <Route
                      index
                      element={<NavigateToResource resource="levels" />}
                    />
                    <Route path="/levels">
                      <Route index element={<LevelList />} />
                      <Route path="create" element={<LevelCreate />} />
                      <Route path="edit/:id" element={<LevelEdit />} />
                      <Route path="show/:id" element={<LevelShow />} />
                    </Route>
                    <Route path="/letter">
                      <Route index element={<LetterList />} />
                      <Route path="create" element={<LetterCreate />} />
                      <Route path="edit/:id" element={<LetterEdit />} />
                    </Route>
                    <Route path="/phrase">
                      <Route index element={<PhraseList />} />
                      <Route path="create" element={<PhraseCreate />} />
                      <Route path="edit/:id" element={<PhraseEdit />} />
                    </Route>
                    <Route path="*" element={<ErrorComponent />} />
                  </Route>
                  <Route
                    element={
                      <Authenticated
                        key="authenticated-outer"
                        fallback={<Outlet />}
                      >
                        <NavigateToResource />
                      </Authenticated>
                    }
                  >
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route
                      path="/forgot-password"
                      element={<ForgotPassword />}
                    />
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
