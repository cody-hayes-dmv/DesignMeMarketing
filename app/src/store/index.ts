import { configureStore } from "@reduxjs/toolkit";
import authSlice from "./slices/authSlice";
import agencySlice from "./slices/agencySlice";
import taskSlice from "./slices/taskSlice";
import clientSlice from "./slices/clientSlice";

export const store = configureStore({
  reducer: {
    auth: authSlice,
    agency: agencySlice,
    task: taskSlice,
    client: clientSlice,
  },
  devTools: import.meta.env.DEV
    ? { name: "MyApp Store", trace: true, traceLimit: 25 }
    : false,
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
