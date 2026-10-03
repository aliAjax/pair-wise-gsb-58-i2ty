import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import alertsReducer from "../features/alerts/alertsSlice";
import { bankApi } from "../services/api";

export const store = configureStore({
  reducer: {
    alertsUi: alertsReducer,
    [bankApi.reducerPath]: bankApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(bankApi.middleware),
});

setupListeners(store.dispatch);

// 另一个窗口写入业务库后，本窗口的 RTK Query 缓存即时失效重拉
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "bank-fraud-investigation-db-v1") {
      store.dispatch(
        bankApi.util.invalidateTags([
          "Alerts",
          "Cases",
          "Case",
          "Audit",
          "Dashboard",
        ]),
      );
    }
  });
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
