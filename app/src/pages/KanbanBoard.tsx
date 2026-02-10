import React from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "react-beautiful-dnd";
import { Task } from "@/utils/types";
import { truncateText } from "@/utils";
import { Calendar, User } from "lucide-react";
import { format } from "date-fns";

interface KanbanBoardProps {
    tasks: Task[];
    onMove?: (id: string, status: "TODO" | "IN_PROGRESS" | "REVIEW" | "DONE") => void;
    onTaskClick?: (task: Task) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, onMove, onTaskClick }) => {
    const columns = {
        TODO: tasks.filter((t) => t.status === "TODO"),
        IN_PROGRESS: tasks.filter((t) => t.status === "IN_PROGRESS"),
        REVIEW: tasks.filter((t) => t.status === "REVIEW"),
        DONE: tasks.filter((t) => t.status === "DONE"),
    };

    const onDragEnd = (result: DropResult) => {
        const { destination, source, draggableId } = result;
        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        const newStatus = destination.droppableId as Task["status"];
        onMove?.(draggableId, newStatus);
    };

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex justify-between gap-3">
                {Object.entries(columns).map(([colId, colTasks]) => (
                    <Droppable droppableId={colId} key={colId}>
                        {(provided, snapshot) => (
                            <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={`p-3 rounded-md w-72 min-h-[80vh] transition-colors ${snapshot.isDraggingOver ? "bg-gray-100" : "bg-gray-50"
                                    }`}
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <span className="font-bold">{colId.replace("_", " ")}</span>
                                    <span className="text-xs bg-gray-200 rounded px-2 py-0.5">{colTasks.length}</span>
                                </div>
                                {colTasks.map((task, index) => (
                                    <Draggable draggableId={task.id} index={index} key={task.id}>
                                        {(provided, snapshot) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...provided.dragHandleProps}
                                                className={`space-y-2 p-3 mb-2 bg-white rounded shadow-sm cursor-pointer transition-transform ${snapshot.isDragging ? "ring-2 ring-blue-400" : "hover:shadow-md"}`}
                                                onClick={() => onTaskClick?.(task)}
                                            >
                                                <div className="flex flex-row justify-between">
                                                    <div>
                                                        <p className="text-sm font-semibold">{truncateText(task.title, 25)}</p>
                                                        {task.client ?
                                                            <p className="text-xs underline">{task.client?.name}({truncateText(task.client?.domain, 11)})</p>
                                                            :
                                                            <p className="text-xs underline">No Client</p>
                                                        }
                                                    </div>
                                                    <div>
                                                        <span className="px-2 py-1 font-medium rounded-full text-[10px] text-gray-600 bg-gray-100">
                                                            {task?.category ?? "Uncategorized"}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-row items-center justify-between">
                                                    <div className="flex flex-row gap-1 items-center text-sm font-semibold">
                                                        <User size={18} />
                                                        <span className="text-sm text-gray-600">{task.assignee?.name ?? "Unassigned"}</span>
                                                    </div>
                                                </div>
                                                {task.dueDate &&
                                                    <div className="flex flex-row items-center justify-between">
                                                        <div className="flex flex-row gap-1 items-center text-sm font-semibold">
                                                            <Calendar className="text-gray-400" size={18} />
                                                            <span className="text-xs text-gray-400">{format(new Date(task.dueDate), "yyyy-MM-dd")}</span>
                                                        </div>
                                                        <div className="">
                                                            <span className={`text-xs text-gray-400 rounded-full px-2 py-[1px] ${new Date(task.dueDate) > new Date() ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>{new Date(task.dueDate) > new Date() ? "Upcoming" : "Overdue"}</span>
                                                        </div>
                                                    </div>
                                                }
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                ))
                }
            </div >
        </DragDropContext >
    );
};

export default KanbanBoard;
