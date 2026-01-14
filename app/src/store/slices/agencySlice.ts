import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import api from "@/lib/api";

export interface Agency {
  id: string;
  name: string;
  subdomain?: string;
  createdAt: string;
  memberCount: number;
}

interface AgencyState {
  agencies: Agency[];
  loading: boolean;
  error: string | null;
}

const initialState: AgencyState = {
  agencies: [],
  loading: false,
  error: null,
};

export const fetchAgencies = createAsyncThunk(
  "agency/fetchAgencies",
  async () => {
    try {
      const response = await api.get("/agencies");
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to fetch agencies"
      );
    }
  }
);

export const inviteAgency = createAsyncThunk(
  "agency/inviteAgency",
  async ({ email, name }: { email: string; name: string }) => {
    try {
      const response = await api.post("/agencies/invite", { email, name });
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to invite agency"
      );
    }
  }
);

export const createAgency = createAsyncThunk(
  "agency/createAgency",
  async ({ name, subdomain }: { name: string; subdomain?: string }) => {
    try {
      const response = await api.post("/agencies", { name, subdomain });
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to create agency"
      );
    }
  }
);

const agencySlice = createSlice({
  name: "agency",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAgencies.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAgencies.fulfilled, (state, action) => {
        state.loading = false;
        state.agencies = action.payload;
      })
      .addCase(fetchAgencies.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to fetch agencies";
      })
      .addCase(inviteAgency.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(inviteAgency.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(inviteAgency.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to invite agency";
      })
      .addCase(createAgency.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createAgency.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(createAgency.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to create agency";
      });
  },
});

export const { clearError } = agencySlice.actions;
export default agencySlice.reducer;
