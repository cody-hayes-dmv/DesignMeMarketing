export type TaskStatus = "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE";
export type ROLE = "SUPER_ADMIN" | "ADMIN" | "AGENCY" | "SPECIALIST" | "USER";

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
    loginUrl?: string | null;
    username?: string | null;
    password?: string | null;
    notes?: string | null;
  } | null;
  agency?: {
    id: string;
    name: string;
  } | null;
}

export type Column = {
  id: string;
  title: string;
  taskIds: string[];
};

export type KanbanBoardType = {
  tasks: Record<string, Task>;
  columns: Record<string, Column>;
  columnOrder: string[];
};

export type User = {
  _id: string;
  name: string;
  email: string;
  role: ROLE;
  verified: boolean;
  invited: boolean;
  createdAt: string;
};
