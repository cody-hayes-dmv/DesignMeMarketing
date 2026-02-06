import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import api from "@/lib/api";

export interface Agency {
  id: string;
  name: string;
  subdomain?: string;
  createdAt: string;
  memberCount: number;
  clientCount?: number;
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
  async ({
    name,
    website,
    industry,
    agencySize,
    numberOfClients,
    contactName,
    contactEmail,
    contactPhone,
    contactJobTitle,
    streetAddress,
    city,
    state,
    zip,
    country,
    subdomain,
    billingOption,
    tier,
    customPricing,
    internalNotes,
    referralSource,
    referralSourceOther,
    primaryGoals,
    primaryGoalsOther,
    currentTools,
  }: {
    name: string;
    website?: string;
    industry?: string;
    agencySize?: string;
    numberOfClients?: number | null;
    contactName: string;
    contactEmail: string;
    contactPhone?: string;
    contactJobTitle?: string;
    streetAddress?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    subdomain?: string;
    billingOption: "charge" | "no_charge" | "manual_invoice";
    tier?: "solo" | "starter" | "growth" | "pro" | "enterprise" | "business_lite" | "business_pro";
    customPricing?: number | null;
    internalNotes?: string;
    referralSource?: string;
    referralSourceOther?: string;
    primaryGoals?: string[];
    primaryGoalsOther?: string;
    currentTools?: string;
  }) => {
    try {
      const response = await api.post("/agencies", {
        name,
        website,
        industry,
        agencySize,
        numberOfClients,
        contactName,
        contactEmail,
        contactPhone,
        contactJobTitle,
        streetAddress,
        city,
        state,
        zip,
        country,
        subdomain,
        billingOption,
        tier,
        customPricing,
        internalNotes,
        referralSource,
        referralSourceOther,
        primaryGoals,
        primaryGoalsOther,
        currentTools,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to create agency"
      );
    }
  }
);

export const deleteAgency = createAsyncThunk(
  "agency/deleteAgency",
  async (agencyId: string) => {
    try {
      await api.delete(`/agencies/${agencyId}`);
      return agencyId;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to delete agency"
      );
    }
  }
);

export const assignClientToAgency = createAsyncThunk(
  "agency/assignClientToAgency",
  async ({ agencyId, clientId }: { agencyId: string; clientId: string }) => {
    try {
      const response = await api.post(`/agencies/${agencyId}/assign-client/${clientId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to assign client to agency"
      );
    }
  }
);

export const removeClientFromAgency = createAsyncThunk(
  "agency/removeClientFromAgency",
  async ({ agencyId, clientId }: { agencyId: string; clientId: string }) => {
    try {
      const response = await api.post(`/agencies/${agencyId}/remove-client/${clientId}`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to remove client from agency"
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
      })
      .addCase(deleteAgency.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(deleteAgency.fulfilled, (state, action) => {
        state.loading = false;
        state.agencies = state.agencies.filter(agency => agency.id !== action.payload);
      })
      .addCase(deleteAgency.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to delete agency";
      })
      .addCase(assignClientToAgency.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(assignClientToAgency.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(assignClientToAgency.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to assign client to agency";
      })
      .addCase(removeClientFromAgency.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(removeClientFromAgency.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(removeClientFromAgency.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to remove client from agency";
      });
  },
});

export const { clearError } = agencySlice.actions;
export default agencySlice.reducer;
