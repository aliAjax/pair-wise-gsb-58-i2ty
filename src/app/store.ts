import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import alertsReducer from "../features/alerts/alertsSlice";
import { bankApi } from "../services/api";
import { STORAGE_KEY } from "../services/mockStorage";
import { TRIAGE_STORAGE_KEY } from "../services/triageStorage";

export const store = configureStore({
  reducer: {
    alertsUi: alertsReducer,
    [bankApi.reducerPath]: bankApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(bankApi.middleware),
});

setupListeners(store.dispatch);

// 另一个窗口提交批次或重置数据后，本窗口监听 storage 事件并刷新缓存，
// 保证两名调查员看到的案件、告警与批次状态一致。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
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
    if (event.key === TRIAGE_STORAGE_KEY) {
      store.dispatch(bankApi.util.invalidateTags(["TriageBatches"]));
    }
  });
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
