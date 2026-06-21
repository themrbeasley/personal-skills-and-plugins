import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GoogleHandler } from "./google-handler";
import { refreshAccessToken, type Props } from "./utils";
import {
	listTaskLists,
	createTaskList,
	updateTaskList,
	deleteTaskList,
	listTasks,
	createTask,
	updateTask,
	deleteTask,
	moveTask,
	clearCompleted,
} from "./google-tasks-api";

export class GoogleTasksMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Google Tasks",
		version: "1.0.0",
	});

	/**
	 * Get a valid Google access token, refreshing if expired.
	 */
	private async getValidToken(): Promise<string> {
		if (Date.now() < this.props!.expiresAt - 60_000) {
			return this.props!.accessToken;
		}
		// Token expired or expiring soon -- refresh it
		const refreshed = await refreshAccessToken(
			this.props!.refreshToken,
			this.env.GOOGLE_CLIENT_ID,
			this.env.GOOGLE_CLIENT_SECRET,
		);
		this.props!.accessToken = refreshed.accessToken;
		this.props!.expiresAt = refreshed.expiresAt;
		return refreshed.accessToken;
	}

	async init() {
		// --- Task List tools ---

		this.server.tool(
			"list_task_lists",
			"List all Google Tasks lists",
			{},
			async () => {
				const token = await this.getValidToken();
				const lists = await listTaskLists(token);
				return {
					content: [{ type: "text", text: JSON.stringify(lists, null, 2) }],
				};
			},
		);

		this.server.tool(
			"create_task_list",
			"Create a new Google Tasks list",
			{ title: z.string().describe("Title for the new task list") },
			async ({ title }) => {
				const token = await this.getValidToken();
				const list = await createTaskList(token, title);
				return {
					content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
				};
			},
		);

		this.server.tool(
			"update_task_list",
			"Rename a Google Tasks list",
			{
				taskListId: z.string().describe("ID of the task list to update"),
				title: z.string().describe("New title for the task list"),
			},
			async ({ taskListId, title }) => {
				const token = await this.getValidToken();
				const list = await updateTaskList(token, taskListId, title);
				return {
					content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
				};
			},
		);

		this.server.tool(
			"delete_task_list",
			"Delete a Google Tasks list",
			{ taskListId: z.string().describe("ID of the task list to delete") },
			async ({ taskListId }) => {
				const token = await this.getValidToken();
				await deleteTaskList(token, taskListId);
				return {
					content: [{ type: "text", text: `Task list ${taskListId} deleted.` }],
				};
			},
		);

		// --- Task tools ---

		this.server.tool(
			"list_tasks",
			"List tasks in a Google Tasks list",
			{
				taskListId: z.string().describe("ID of the task list"),
				showCompleted: z.boolean().optional().default(true).describe("Include completed tasks"),
				showHidden: z.boolean().optional().default(false).describe("Include hidden tasks"),
			},
			async ({ taskListId, showCompleted, showHidden }) => {
				const token = await this.getValidToken();
				const tasks = await listTasks(token, taskListId, { showCompleted, showHidden });
				return {
					content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }],
				};
			},
		);

		this.server.tool(
			"create_task",
			"Create a new task in a Google Tasks list",
			{
				taskListId: z.string().describe("ID of the task list"),
				title: z.string().describe("Task title"),
				notes: z.string().optional().describe("Task notes/description"),
				due: z.string().optional().describe("Due date in RFC 3339 format (e.g. 2026-04-15T00:00:00.000Z)"),
			},
			async ({ taskListId, title, notes, due }) => {
				const token = await this.getValidToken();
				const task = await createTask(token, taskListId, { title, notes, due });
				return {
					content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
				};
			},
		);

		this.server.tool(
			"update_task",
			"Update a task's title, notes, or due date",
			{
				taskListId: z.string().describe("ID of the task list"),
				taskId: z.string().describe("ID of the task to update"),
				title: z.string().optional().describe("New task title"),
				notes: z.string().optional().describe("New task notes"),
				due: z.string().optional().describe("New due date in RFC 3339 format"),
			},
			async ({ taskListId, taskId, title, notes, due }) => {
				const token = await this.getValidToken();
				const fields: Record<string, string> = {};
				if (title !== undefined) fields.title = title;
				if (notes !== undefined) fields.notes = notes;
				if (due !== undefined) fields.due = due;
				const task = await updateTask(token, taskListId, taskId, fields);
				return {
					content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
				};
			},
		);

		this.server.tool(
			"complete_task",
			"Mark a task as completed",
			{
				taskListId: z.string().describe("ID of the task list"),
				taskId: z.string().describe("ID of the task to complete"),
			},
			async ({ taskListId, taskId }) => {
				const token = await this.getValidToken();
				const task = await updateTask(token, taskListId, taskId, { status: "completed" });
				return {
					content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
				};
			},
		);

		this.server.tool(
			"delete_task",
			"Delete a task",
			{
				taskListId: z.string().describe("ID of the task list"),
				taskId: z.string().describe("ID of the task to delete"),
			},
			async ({ taskListId, taskId }) => {
				const token = await this.getValidToken();
				await deleteTask(token, taskListId, taskId);
				return {
					content: [{ type: "text", text: `Task ${taskId} deleted.` }],
				};
			},
		);

		this.server.tool(
			"move_task",
			"Move a task to a different position or make it a subtask",
			{
				taskListId: z.string().describe("ID of the task list"),
				taskId: z.string().describe("ID of the task to move"),
				parent: z.string().optional().describe("ID of the new parent task (to make it a subtask)"),
				previous: z.string().optional().describe("ID of the task to place this after"),
			},
			async ({ taskListId, taskId, parent, previous }) => {
				const token = await this.getValidToken();
				const task = await moveTask(token, taskListId, taskId, { parent, previous });
				return {
					content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
				};
			},
		);

		this.server.tool(
			"clear_completed",
			"Remove all completed tasks from a list",
			{ taskListId: z.string().describe("ID of the task list to clear") },
			async ({ taskListId }) => {
				const token = await this.getValidToken();
				await clearCompleted(token, taskListId);
				return {
					content: [{ type: "text", text: `Completed tasks cleared from list ${taskListId}.` }],
				};
			},
		);
	}
}

export default new OAuthProvider({
	apiHandler: GoogleTasksMCP.serve("/"),
	apiRoute: "/",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: GoogleHandler as any,
	tokenEndpoint: "/token",
});
