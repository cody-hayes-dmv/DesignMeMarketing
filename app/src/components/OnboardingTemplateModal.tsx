import React, { useState, useEffect } from "react";
import { X, Plus, Clock, User, Calendar, AlertCircle, CheckCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { RootState } from "@/store";
import api from "@/lib/api";

interface OnboardingTemplate {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  tasks: OnboardingTask[];
}

interface OnboardingTask {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  estimatedHours: number | null;
  order: number;
}

interface Client {
  id: string;
  name: string;
  domain: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface OnboardingTemplateModalProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  onTasksCreated: () => void;
}

const OnboardingTemplateModal: React.FC<OnboardingTemplateModalProps> = ({
  open,
  setOpen,
  onTasksCreated,
}) => {
  const { user } = useSelector((state: RootState) => state.auth);
  
  const [templates, setTemplates] = useState<OnboardingTemplate[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [workers, setWorkers] = useState<User[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<OnboardingTemplate | null>(null);
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [selectedWorker, setSelectedWorker] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  // Fetch templates, clients, and workers on modal open
  useEffect(() => {
    if (open) {
      fetchTemplates();
      fetchClients();
      fetchWorkers();
    }
  }, [open]);

  const fetchTemplates = async () => {
    try {
      const response = await api.get("/onboarding/templates");
      setTemplates(response.data);
    } catch (error: any) {
      console.error("Error fetching templates:", error);
      // Toast is already shown by API interceptor
    }
  };

  const fetchClients = async () => {
    try {
      const response = await api.get("/clients");
      setClients(response.data);
    } catch (error: any) {
      console.error("Error fetching clients:", error);
      // Toast is already shown by API interceptor
    }
  };

  const fetchWorkers = async () => {
    try {
      const response = await api.get("/auth/workers");
      setWorkers(response.data);
    } catch (error: any) {
      console.error("Error fetching workers:", error);
      // Toast is already shown by API interceptor
    }
  };

  const handleCreateTasks = async () => {
    if (!selectedTemplate || !selectedClient) {
      setError("Please select a template and client");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const tasks = selectedTemplate.tasks.map((templateTask) => ({
        title: templateTask.title,
        description: templateTask.description,
        category: templateTask.category,
        status: "TODO" as const,
        clientId: selectedClient,
        assigneeId: selectedWorker || null,
        dueDate: dueDate || null,
        estimatedHours: templateTask.estimatedHours,
        priority: templateTask.priority,
      }));

      await api.post("/tasks/bulk", { tasks });
      
      toast.success(`Successfully created ${tasks.length} task${tasks.length > 1 ? "s" : ""}!`);
      onTasksCreated();
      setOpen(false);
      resetForm();
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || "Failed to create tasks";
      setError(errorMsg);
      // Toast is already shown by API interceptor
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedTemplate(null);
    setSelectedClient("");
    setSelectedWorker("");
    setDueDate("");
    setError("");
  };

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case "high":
        return "text-red-600 bg-red-100";
      case "medium":
        return "text-yellow-600 bg-yellow-100";
      case "low":
        return "text-green-600 bg-green-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  const getPriorityIcon = (priority: string | null) => {
    switch (priority) {
      case "high":
        return <AlertCircle className="h-3 w-3" />;
      case "medium":
        return <Clock className="h-3 w-3" />;
      case "low":
        return <CheckCircle className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Create Onboarding Tasks</h2>
            <p className="text-gray-600 mt-1">Generate tasks from predefined templates for new clients</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-6 w-6 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center">
                <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
                <span className="text-red-700">{error}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Template Selection */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Template</h3>
              <div className="space-y-3">
                {templates.map((template) => (
                  <div
                    key={template.id}
                    onClick={() => setSelectedTemplate(template)}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedTemplate?.id === template.id
                        ? "border-primary-500 bg-primary-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-gray-900">{template.name}</h4>
                        {template.description && (
                          <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">
                          {template.tasks.length} tasks • {template.tasks.reduce((sum, task) => sum + (task.estimatedHours || 0), 0)} hours
                        </p>
                      </div>
                      {template.isDefault && (
                        <span className="px-2 py-1 text-xs font-medium text-primary-600 bg-primary-100 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Configuration */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Configuration</h3>
              <div className="space-y-4">
                {/* Client Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Client *
                  </label>
                  <select
                    value={selectedClient}
                    onChange={(e) => setSelectedClient(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Select a client</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name} ({client.domain})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Worker Assignment */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assign to Worker
                  </label>
                  <select
                    value={selectedWorker}
                    onChange={(e) => setSelectedWorker(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">Unassigned</option>
                    {workers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        {worker.name} ({worker.email})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Selected Template Tasks Preview */}
          {selectedTemplate && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Tasks to be Created ({selectedTemplate.tasks.length})
              </h3>
              <div className="space-y-3">
                {selectedTemplate.tasks
                  .sort((a, b) => a.order - b.order)
                  .map((task, index) => (
                    <div key={task.id} className="p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                            <h4 className="font-medium text-gray-900">{task.title}</h4>
                            {task.priority && (
                              <span className={`px-2 py-1 text-xs font-medium rounded-full flex items-center space-x-1 ${getPriorityColor(task.priority)}`}>
                                {getPriorityIcon(task.priority)}
                                <span className="capitalize">{task.priority}</span>
                              </span>
                            )}
                          </div>
                          {task.description && (
                            <p className="text-sm text-gray-600 mt-1">{task.description}</p>
                          )}
                          <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                            {task.category && (
                              <span className="px-2 py-1 bg-gray-200 rounded">
                                {task.category}
                              </span>
                            )}
                            {task.estimatedHours && (
                              <span className="flex items-center space-x-1">
                                <Clock className="h-3 w-3" />
                                <span>{task.estimatedHours}h</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateTasks}
            disabled={loading || !selectedTemplate || !selectedClient}
            className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Creating Tasks...</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                <span>Create {selectedTemplate?.tasks.length || 0} Tasks</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTemplateModal;
