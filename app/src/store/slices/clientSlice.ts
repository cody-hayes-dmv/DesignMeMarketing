import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import api from "../../lib/api";

export interface Client {
  id: string;
  name: string;
  domain: string;
  status: "ACTIVE" | "PENDING" | "REJECTED";
  industry?: string;
  targets?: string[];
  createdAt: string;
  updatedAt: string;
  userId: string;
  keywords?: Keyword[] | number;
  rankings?: Ranking[];
  avgPosition?: number;
  topRankings?: number;
  traffic?: number;
}

export interface Keyword {
  id: string;
  keyword: string;
  searchVolume: number;
  difficulty?: number | null;
  cpc?: number | null;
  competition?: string | null;
  locationName?: string | null;
  currentPosition?: number | null;
  previousPosition?: number | null;
  bestPosition?: number | null;
  googleUrl?: string | null;
  serpFeatures?: string[] | null;
  totalResults?: number | null;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  clientId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ranking {
  id: string;
  keyword: string;
  position: number;
  previousPosition?: number;
  url: string;
  searchVolume: number;
  date: string;
  projectId: string;
}

interface ClientState {
  clients: Client[];
  currentClient: Client | null;
  keywords: Keyword[];
  keywordsByClient: Record<string, Keyword[]>;
  rankings: Ranking[];
  loading: boolean;
  error: string | null;
}

const initialState: ClientState = {
  clients: [],
  currentClient: null,
  keywords: [],
  keywordsByClient: {},
  rankings: [],
  loading: false,
  error: null,
};

export const fetchClients = createAsyncThunk(
  "client/fetchClients",
  async () => {
    try {
      const response = await api.get("/clients");
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to fetch clients"
      );
    }
  }
);

export const createClient = createAsyncThunk(
  "client/createClient",
  async ({ id: _id, data }: { id?: string; data: any }) => {
    try {
      const response = await api.post(`/clients`, data);
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to create client"
      );
    }
  }
);

export const deleteClient = createAsyncThunk(
  "client/deleteClient",
  async (id: string) => {
    try {
      await api.delete(`/clients/${id}`);
      return id;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to delete client"
      );
    }
  }
);

export const updateClient = createAsyncThunk(
  "client/updateClient",
  async ({ id, data }: { id: string; data: any }) => {
    try {
      const response = await api.put(`/clients/${id}`, { data });
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to update client"
      );
    }
  }
);

export const fetchKeywords = createAsyncThunk(
  "client/fetchKeywords",
  async (clientId: string) => {
    try {
      const response = await api.get(`/seo/keywords/${clientId}`);
      return { clientId, keywords: response.data };
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to fetch keywords"
      );
    }
  }
);

export const addKeyword = createAsyncThunk(
  "client/addKeyword",
  async ({
    clientId,
    keyword,
    searchVolume,
    difficulty,
    cpc,
    competition,
    currentPosition,
    previousPosition,
    bestPosition,
    fetchFromDataForSEO,
    locationCode,
    languageCode,
  }: {
    clientId: string;
    keyword: string;
    searchVolume: number;
    difficulty?: number;
    cpc?: number;
    competition?: string;
    currentPosition?: number;
    previousPosition?: number;
    bestPosition?: number;
    fetchFromDataForSEO?: boolean;
    locationCode?: number;
    languageCode?: string;
  }) => {
    try {
      const response = await api.post(`/seo/keywords/${clientId}`, {
        keyword,
        searchVolume,
        difficulty,
        cpc,
        competition,
        currentPosition,
        previousPosition,
        bestPosition,
        fetchFromDataForSEO,
        locationCode,
        languageCode,
      });
      return { clientId, keyword: response.data.keyword || response.data };
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Failed to add keyword");
    }
  }
);

export const refreshKeyword = createAsyncThunk(
  "client/refreshKeyword",
  async ({
    clientId,
    keywordId,
    locationCode,
    languageCode,
  }: {
    clientId: string;
    keywordId: string;
    locationCode?: number;
    languageCode?: string;
  }) => {
    try {
      const response = await api.post(`/seo/keywords/${clientId}/${keywordId}/refresh`, {
        locationCode,
        languageCode,
      });
      // Ensure we have the keyword data
      const keywordData = response.data.keyword || response.data;
      console.log("Refresh keyword response:", keywordData);
      return { clientId, keyword: keywordData };
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Failed to refresh keyword");
    }
  }
);

export const fetchRankings = createAsyncThunk(
  "client/fetchRankings",
  async (clientId: string) => {
    try {
      const response = await api.get(`/clients/${clientId}/rankings`);
      return response.data;
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || "Failed to fetch rankings"
      );
    }
  }
);

const clientSlice = createSlice({
  name: "client",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setCurrentClient: (state, action) => {
      state.currentClient = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchClients.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchClients.fulfilled, (state, action) => {
        state.loading = false;
        state.clients = action.payload;
      })
      .addCase(fetchClients.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to fetch clients";
      })
      .addCase(createClient.fulfilled, (state, action) => {
        state.clients.push(action.payload);
      })
      .addCase(updateClient.fulfilled, (state, action) => {
        // replace updated client in the list
        const idx = state.clients.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) {
          state.clients[idx] = action.payload;
        }
      })
      .addCase(fetchKeywords.fulfilled, (state, action) => {
        state.keywordsByClient[action.payload.clientId] = action.payload.keywords;
        // Also update the flat keywords array for backward compatibility
        state.keywords = Object.values(state.keywordsByClient).flat();
      })
      .addCase(addKeyword.fulfilled, (state, action) => {
        const { clientId, keyword } = action.payload;
        if (!state.keywordsByClient[clientId]) {
          state.keywordsByClient[clientId] = [];
        }
        state.keywordsByClient[clientId].push(keyword);
        // Also update the flat keywords array for backward compatibility
        state.keywords = Object.values(state.keywordsByClient).flat();
      })
      .addCase(refreshKeyword.fulfilled, (state, action) => {
        const { clientId, keyword } = action.payload;
        console.log("Updating keyword in state:", { clientId, keyword });
        
        if (state.keywordsByClient[clientId]) {
          const index = state.keywordsByClient[clientId].findIndex(k => k.id === keyword.id);
          if (index !== -1) {
            // Update the keyword with all the new data - spread operator will overwrite all fields
            // This ensures currentPosition, previousPosition, googleUrl, etc. are all updated
            state.keywordsByClient[clientId][index] = {
              ...state.keywordsByClient[clientId][index],
              ...keyword,
            };
            console.log("Updated keyword at index:", index, state.keywordsByClient[clientId][index]);
          } else {
            // If keyword not found, add it to the array
            state.keywordsByClient[clientId].push(keyword);
          }
        } else {
          // If client doesn't exist in keywordsByClient, create it
          state.keywordsByClient[clientId] = [keyword];
        }
        // Also update the flat keywords array for backward compatibility
        state.keywords = Object.values(state.keywordsByClient).flat();
      })
      .addCase(fetchRankings.fulfilled, (state, action) => {
        state.rankings = action.payload;
      })
      .addCase(deleteClient.fulfilled, (state, action) => {
        state.clients = state.clients.filter((c) => c.id !== action.payload);
      });
  },
});

export const { clearError, setCurrentClient } = clientSlice.actions;
export default clientSlice.reducer;
