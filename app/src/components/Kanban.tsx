import React, { useState } from "react";
import {
    DragDropContext,
    Droppable,
    Draggable,
    DropResult,
} from "react-beautiful-dnd";

import { Task, Column, KanbanBoardType } from "@/utils/types"

// Convert tasks array to tasks record
const tasksArray: Task[] = [
    {
        _id: "t1",
        title: "Keyword Research",
        description: "Research top-performing keywords for bakery website.",
        createdAt: "2025-09-19T08:00:00Z",
        status: "TODO",
    },
    {
        _id: "t2",
        title: "On-Page SEO Audit",
        description: "Analyze homepage and product pages for SEO improvements.",
        createdAt: "2025-09-18T14:30:00Z",
        status: "IN_PROGRESS",
    },
    {
        _id: "t3",
        title: "Backlink Outreach",
        description: "Contact relevant websites for backlink opportunities.",
        createdAt: "2025-09-17T10:15:00Z",
        status: "REVIEW",
    },
    {
        _id: "t4",
        title: "Content Brief Creation",
        description: "Create content briefs for blog posts targeting main keywords.",
        createdAt: "2025-09-16T09:45:00Z",
        status: "IN_PROGRESS",
    },
    {
        _id: "t5",
        title: "SILO Structure Mapping",
        description: "Plan website SILO architecture based on keywords and categories.",
        createdAt: "2025-09-15T16:20:00Z",
        status: "DONE",
    },
    {
        _id: "t6",
        title: "Rank Tracking Setup",
        description: "Set up daily rank tracking for top 20 keywords.",
        createdAt: "2025-09-14T12:00:00Z",
        status: "TODO",
    },
    {
        _id: "t7",
        title: "Competitor Analysis",
        description: "Analyze top competitors’ backlink profiles and content strategies.",
        createdAt: "2025-09-13T11:10:00Z",
        status: "DONE",
    },
];

// Initialize columns
const columns: Record<string, Column> = {
    TODO: {
        id: "TODO",
        title: "To Do",
        taskIds: tasksArray.filter(t => t.status === "TODO").map(t => t._id),
    },
    IN_PROGRESS: {
        id: "IN_PROGRESS",
        title: "In Progress",
        taskIds: tasksArray.filter(t => t.status === "IN_PROGRESS").map(t => t._id),
    },
    REVIEW: {
        id: "REVIEW",
        title: "Review",
        taskIds: tasksArray.filter(t => t.status === "REVIEW").map(t => t._id),
    },
    DONE: {
        id: "DONE",
        title: "Done",
        taskIds: tasksArray.filter(t => t.status === "DONE").map(t => t._id),
    },
};

// Convert tasks array to record
const tasksRecord: Record<string, Task> = {};

tasksArray.forEach(task => {
    tasksRecord[task._id] = task;
});

export const kanbanBoard: KanbanBoardType = {
    tasks: tasksRecord,
    columns,
    columnOrder: ["TODO", "IN_PROGRESS", "REVIEW", "DONE"],
};


const KanbanBoard = () => {
    const [board, setBoard] = useState<KanbanBoardType>(kanbanBoard);

    const onDragEnd = (result: DropResult) => {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (
            destination.droppableId === source.droppableId &&
            destination.index === source.index
        )
            return;

        const startColumn = board.columns[source.droppableId];
        const finishColumn = board.columns[destination.droppableId];

        // Moving inside same column
        if (startColumn === finishColumn) {
            const newTaskIds = Array.from(startColumn.taskIds);
            newTaskIds.splice(source.index, 1);
            newTaskIds.splice(destination.index, 0, draggableId);

            const newColumn = { ...startColumn, taskIds: newTaskIds };
            setBoard({ ...board, columns: { ...board.columns, [newColumn.id]: newColumn } });
            return;
        }

        // Moving to different column
        const startTaskIds = Array.from(startColumn.taskIds);
        startTaskIds.splice(source.index, 1);
        const newStart = { ...startColumn, taskIds: startTaskIds };

        const finishTaskIds = Array.from(finishColumn.taskIds);
        finishTaskIds.splice(destination.index, 0, draggableId);
        const newFinish = { ...finishColumn, taskIds: finishTaskIds };

        // Update task status
        const updatedTask = { ...board.tasks[draggableId], status: finishColumn.id };

        setBoard({
            ...board,
            tasks: { ...board.tasks, [draggableId]: updatedTask },
            columns: { ...board.columns, [newStart.id]: newStart, [newFinish.id]: newFinish },
        });
    };

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 3 }}>
                {board.columnOrder.map((columnId: any) => {
                    const column = board.columns[columnId];
                    const tasks = column.taskIds.map((taskId: any) => board.tasks[taskId]);

                    return (
                        <Droppable droppableId={column.id} key={column.id}>
                            {(provided: any, snapshot: any) => (
                                <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    style={{
                                        background: snapshot.isDraggingOver ? "#f0f0f0" : "none",
                                        padding: 8,
                                        width: 400,
                                        height: "100vh",
                                        borderRadius: 6,
                                    }}
                                >
                                    <div className="space-x-3 p-3 mb-5 rounded-md bg-white shadow-md">
                                        <span className="font-bold">{column.title}</span>
                                        {
                                            column.id == "TODO" ? (
                                                <span className="inline-flex items-center rounded-md bg-yellow-400/10 px-2 py-1 text-xs font-medium text-yellow-500 inset-ring inset-ring-yellow-400/20">
                                                    {column.taskIds.length}
                                                </span>
                                            ) : column.id == "IN_PROGRESS" ? (
                                                <span className="inline-flex items-center rounded-md bg-green-400/10 px-2 py-1 text-xs font-medium text-green-400 inset-ring inset-ring-green-500/20">
                                                    {column.taskIds.length}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center rounded-md bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 inset-ring inset-ring-blue-400/30">
                                                    {column.taskIds.length}
                                                </span>
                                            )
                                        }
                                    </div>
                                    {tasks.map((task: any, index: any) => (
                                        <Draggable draggableId={task._id} index={index} key={task._id}>
                                            {(provided: any, snapshot: any) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    {...provided.dragHandleProps}
                                                    style={{
                                                        userSelect: "none",
                                                        padding: 16,
                                                        margin: "0 0 8px 0",
                                                        minHeight: "50px",
                                                        backgroundColor: "white",
                                                        color: "#333",
                                                        borderRadius: 4,
                                                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                                                        ...provided.draggableProps.style,
                                                    }}
                                                >
                                                    <strong>{task.title}</strong>
                                                    <p style={{ fontSize: 12 }}>{task.description}</p>
                                                    <small>{new Date(task.createdAt).toLocaleDateString()}</small>
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    );
                })}
            </div>
        </DragDropContext>
    );
};

export default KanbanBoard;
