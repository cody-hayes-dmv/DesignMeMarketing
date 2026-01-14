import { CheckCircle, Clock, AlertCircle } from "lucide-react";

export const getStatusIcon = (status: string) => {
  switch (status) {
    case "DONE":
      return <CheckCircle className="h-5 w-5 text-secondary-500" />;
    case "IN_PROGRESS":
      return <Clock className="h-5 w-5 text-accent-500" />;
    default:
      return <AlertCircle className="h-5 w-5 text-gray-400" />;
  }
};

export const getStatusBadge = (status: string) => {
  const styles = {
    TODO: "bg-gray-100 text-gray-400",
    IN_PROGRESS: "bg-blue-400 text-white",
    REVIEW: "bg-orange-400 text-white",
    DONE: "bg-green-600 text-white",
  };
  return styles[status as keyof typeof styles] || styles.TODO;
};

export function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.slice(0, maxLength) + "...";
}