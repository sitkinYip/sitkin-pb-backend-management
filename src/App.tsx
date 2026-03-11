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
import {
  MultiQuestClueCreate,
  MultiQuestClueEdit,
  MultiQuestClueList,
  MultiQuestClueShow,
} from "./pages/multiQuestClues";
import {
  NotificationCreate,
  NotificationEdit,
  NotificationList,
} from "./pages/notifications";
import { ResourceManager } from "./pages/resourceManager";
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
                  {
                    name: "multi_quest_clues",
                    list: "/multi_quest_clues",
                    create: "/multi_quest_clues/create",
                    edit: "/multi_quest_clues/edit/:id",
                    show: "/multi_quest_clues/show/:id",
                    meta: {
                      label: "多题线索",
                      canDelete: true,
                    },
                  },
                  {
                    name: "notifications",
                    list: "/notifications",
                    create: "/notifications/create",
                    edit: "/notifications/edit/:id",
                    meta: {
                      label: "实时通知",
                      canDelete: true,
                    },
                  },
                  {
                    name: "resource_manager",
                    list: "/resource_manager",
                    meta: {
                      label: "资源管理",
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
                    <Route path="/multi_quest_clues">
                      <Route index element={<MultiQuestClueList />} />
                      <Route path="create" element={<MultiQuestClueCreate />} />
                      <Route path="edit/:id" element={<MultiQuestClueEdit />} />
                      <Route path="show/:id" element={<MultiQuestClueShow />} />
                    </Route>
                    <Route path="/resource_manager"
                      element={<ResourceManager />}
                    />
                    <Route path="/notifications">
                      <Route index element={<NotificationList />} />
                      <Route path="create" element={<NotificationCreate />} />
                      <Route path="edit/:id" element={<NotificationEdit />} />
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
