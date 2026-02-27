import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import api from "../../lib/api";
import { ROLE } from "@/utils/types";

export interface NotificationPreferences {
  emailReports: boolean;
  rankingAlerts: boolean;
  weeklyDigest: boolean;
  teamUpdates: boolean;
}

export interface AgencyBranding {
  agencyId: string;
  brandDisplayName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  subdomain?: string | null;
  customDomain?: string | null;
  domainStatus?: "NONE" | "PENDING_VERIFICATION" | "VERIFIED" | "SSL_PENDING" | "ACTIVE" | "FAILED";
  domainVerifiedAt?: string | null;
  sslIssuedAt?: string | null;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  profileImageUrl?: string | null;
  role: ROLE;
  verified: boolean;
  invited: boolean;
  notificationPreferences?: NotificationPreferences;
  specialties?: string[];
  agencyBranding?: AgencyBranding | null;
  clientAccess?: {
    clients: Array<{ clientId: string; role: string; status: string }>;
  };
}

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  loading: false,
  error: null,
};

export const checkAuth = createAsyncThunk("auth/checkAuth", async () => {
  try {
    const response = await api.get("/auth/me");
    return response.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Authentication failed");
  }
});

export const login = createAsyncThunk(
  "auth/login",
  async ({ email, password }: { email: string; password: string }) => {
    try {
      const response = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", response.data.token);

      return response.data.user;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Login failed");
    }
  }
);

export const register = createAsyncThunk(
  "auth/register",
  async ({
    email,
    password,
    name,
    role,
  }: {
    email: string;
    password: string;
    name: string;
    role: "ADMIN" | "AGENCY" | "USER" | "SPECIALIST";
  }) => {
    try {
      const response = await api.post("/auth/register", {
        email,
        password,
        name,
        role,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Registration failed");
    }
  }
);

export const logout = createAsyncThunk("auth/logout", async () => {
  localStorage.removeItem("token");
});

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkAuth.pending, (state) => {
        state.loading = true;
      })
      .addCase(checkAuth.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
      })
      .addCase(checkAuth.rejected, (state) => {
        state.loading = false;
        state.user = null;
      })
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false;
        state.user = action.payload;
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Login failed";
      })
      .addCase(register.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(register.fulfilled, (state) => {
        state.loading = false;
        state.error = null;
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Registration failed";
      })
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
      });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
