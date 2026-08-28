import { ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import "dayjs/locale/zh-cn";
import {
  type PropsWithChildren,
  createContext,
  useEffect,
  useState,
} from "react";

type ColorModeContextType = {
  mode: string;
  setMode: (mode: string) => void;
};

export const ColorModeContext = createContext<ColorModeContextType>(
  {} as ColorModeContextType,
);

export const ColorModeContextProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const colorModeFromLocalStorage = localStorage.getItem("colorMode");
  const isSystemPreferenceDark = window?.matchMedia(
    "(prefers-color-scheme: dark)",
  ).matches;

  const systemPreference = isSystemPreferenceDark ? "dark" : "light";
  const [mode, setMode] = useState(
    colorModeFromLocalStorage || systemPreference,
  );

  useEffect(() => {
    window.localStorage.setItem("colorMode", mode);
    document.documentElement.dataset.colorMode = mode;
  }, [mode]);

  const setColorMode = (next: string) => {
    setMode(next === "dark" ? "dark" : "light");
  };

  const { darkAlgorithm, defaultAlgorithm } = theme;

  return (
    <ColorModeContext.Provider
      value={{
        setMode: setColorMode,
        mode,
      }}
    >
      <ConfigProvider
        locale={zhCN}
        theme={{
          algorithm: mode === "light" ? defaultAlgorithm : darkAlgorithm,
          token: {
            colorPrimary: "#285ea8",
            colorInfo: "#285ea8",
            colorLink: mode === "light" ? "#285ea8" : "#90b9ee",
            colorLinkHover: mode === "light" ? "#17467f" : "#bdd6f5",
            colorSuccess: "#328067",
            colorWarning: "#b87b24",
            colorBgLayout: mode === "light" ? "#f4f6f8" : "#111820",
            colorBgContainer: mode === "light" ? "#ffffff" : "#19222d",
            colorText: mode === "light" ? "#1f2f46" : "#e7edf5",
            colorTextSecondary: mode === "light" ? "#66768a" : "#a0afc0",
            colorBorderSecondary: mode === "light" ? "#e5eaf0" : "#304052",
            borderRadius: 8,
            controlHeight: 36,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
          },
          components: {
            Button: { primaryShadow: "none", defaultShadow: "none" },
            Table: {
              headerBg: mode === "light" ? "#f8fafc" : "#202c39",
              cellPaddingBlock: 16,
            },
            Form: { labelFontSize: 14 },
            Menu: {
              itemBorderRadius: 6,
              itemSelectedColor: mode === "light" ? "#285ea8" : "#9ac1f3",
              itemSelectedBg: mode === "light" ? "#eaf1fa" : "#233b58",
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ColorModeContext.Provider>
  );
};
