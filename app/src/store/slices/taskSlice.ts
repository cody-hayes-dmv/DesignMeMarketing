// store/taskSlice.ts
import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import api from "@/lib/api";

// Keep Task in sync with API shape (nullable optionals allowed)
export type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";

export interface ProofItem {
  type: "image" | "video" | "url";
  value: string; // URL to the file or external URL
  name?: string; // Optional name/description
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt?: string | null;
  dueDate?: string | null;
  priority?: string | null;
  proof?: ProofItem[] | null; // Array of proof items
  assignee?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  client?: {
    id: string;
    name: string;
    domain: string;
  } | null;
  agency?: {
    id: string;
    name: string;
  } | null;
}

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
}

const initialState: TaskState = {
  tasks: [],
  loading: false,
  error: null,
};

/* ===========================
   Thunks
   =========================== */

export const fetchTasks = createAsyncThunk<Task[]>(
  "task/fetchTasks",
  async () => {
    try {
      const res = await api.get("/tasks");
      return res.data as Task[];
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Failed to fetch tasks");
    }
  }
);

// Create
export const createTask = createAsyncThunk<
  Task,
  {
    title: string;
    description?: string;
    category?: string;
    status?: string;
    dueDate?: string; // ISO
    assigneeId?: string;
    clientId?: string;
    priority?: string;
    estimatedHours?: number;
    proof?: ProofItem[];
  }
>("task/createTask", async (payload) => {
  try {
    const res = await api.post("/tasks", payload);
    return res.data as Task;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to create task");
  }
});

// Update (PUT) – send partials; server merges
export const updateTask = createAsyncThunk<
  Task,
  { id: string } & Partial<{
    title: string;
    description: string | null;
    category: string | null;
    status: TaskStatus;
    dueDate: string | null;
    assigneeId: string | null;
    clientId: string | null;
    priority: string;
    estimatedHours: number;
    proof: ProofItem[] | null;
  }>
>("task/updateTask", async ({ id, ...updates }) => {
  try {
    const res = await api.put(`/tasks/${id}`, updates);
    return res.data as Task;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to update task");
  }
});

// Patch status (Kanban drag)
export const patchTaskStatus = createAsyncThunk<
  Task,
  { id: string; status: TaskStatus }
>("task/patchTaskStatus", async ({ id, status }) => {
  try {
    const res = await api.patch(`/tasks/${id}/status`, { status });
    return res.data as Task;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to update status");
  }
});

// Delete
export const deleteTask = createAsyncThunk<string, string>(
  "task/deleteTask",
  async (id) => {
    try {
      await api.delete(`/tasks/${id}`);
      return id; // return deleted id
    } catch (error: any) {
      throw new Error(error.response?.data?.message || "Failed to delete task");
    }
  }
);

/* ===========================
   Slice
   =========================== */

const taskSlice = createSlice({
  name: "task",
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    // Optional: upsert helper if you want to push/replace from sockets, etc.
    upsertTask: (state, action: PayloadAction<Task>) => {
      const idx = state.tasks.findIndex((t) => t.id === action.payload.id);
      if (idx >= 0) state.tasks[idx] = action.payload;
      else state.tasks.unshift(action.payload);
    },
  },
  extraReducers: (builder) => {
    /* fetch */
    builder
      .addCase(fetchTasks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTasks.fulfilled, (state, action) => {
        state.loading = false;
        state.tasks = action.payload;
      })
      .addCase(fetchTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to fetch tasks";
      });

    /* create */
    builder
      .addCase(createTask.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(createTask.fulfilled, (state, action) => {
        state.loading = false;
        // add newest to top
        state.tasks.unshift(action.payload);
      })
      .addCase(createTask.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to create task";
      });

    /* update (PUT) */
    builder
      .addCase(updateTask.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(updateTask.fulfilled, (state, action) => {
        state.loading = false;
        const idx = state.tasks.findIndex((t) => t.id === action.payload.id);
        if (idx >= 0) state.tasks[idx] = action.payload;
      })
      .addCase(updateTask.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || "Failed to update task";
      });

    /* patch status */
    builder
      .addCase(patchTaskStatus.pending, (state) => {
        state.error = null;
      })
      .addCase(patchTaskStatus.fulfilled, (state, action) => {
        const idx = state.tasks.findIndex((t) => t.id === action.payload.id);
        if (idx >= 0) state.tasks[idx] = action.payload;
      })
      .addCase(patchTaskStatus.rejected, (state, action) => {
        state.error = action.error.message || "Failed to update status";
      });

    /* delete */
    builder
      .addCase(deleteTask.pending, (state) => {
        state.error = null;
      })
      .addCase(deleteTask.fulfilled, (state, action) => {
        state.tasks = state.tasks.filter((t) => t.id !== action.payload);
      })
      .addCase(deleteTask.rejected, (state, action) => {
        state.error = action.error.message || "Failed to delete task";
      });
  },
});

export const { clearError, upsertTask } = taskSlice.actions;
export default taskSlice.reducer;

/* ===========================
   Selectors (optional niceties)
   =========================== */
export const selectTasks = (s: { task: TaskState }) => s.task.tasks;
export const selectTaskLoading = (s: { task: TaskState }) => s.task.loading;
export const selectTaskError = (s: { task: TaskState }) => s.task.error;

export const selectCountsByStatus = (s: { task: TaskState }) => {
  const counts: Record<TaskStatus, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    REVIEW: 0,
    DONE: 0,
  };
  for (const t of s.task.tasks) counts[t.status] += 1;
  return counts;
};
