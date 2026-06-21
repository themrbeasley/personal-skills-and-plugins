// Google Tasks REST API typed wrappers
// Base URL: https://tasks.googleapis.com/tasks/v1

const BASE_URL = "https://tasks.googleapis.com/tasks/v1";

export interface TaskList {
	kind: "tasks#taskList";
	id: string;
	title: string;
	updated: string;
	selfLink: string;
}

export interface Task {
	kind: "tasks#task";
	id: string;
	title: string;
	notes?: string;
	status: "needsAction" | "completed";
	due?: string;
	completed?: string;
	parent?: string;
	position?: string;
	deleted?: boolean;
	hidden?: boolean;
	selfLink?: string;
	webViewLink?: string;
	links?: Array<{ type: string; description: string; link: string }>;
}

interface TaskListsResponse {
	kind: "tasks#taskLists";
	items?: TaskList[];
	nextPageToken?: string;
}

interface TasksResponse {
	kind: "tasks#tasks";
	items?: Task[];
	nextPageToken?: string;
}

async function apiCall<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const resp = await fetch(`${BASE_URL}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});

	if (!resp.ok) {
		const errorText = await resp.text();
		throw new Error(`Google Tasks API error (${resp.status}): ${errorText}`);
	}

	// DELETE and CLEAR return 204 No Content
	if (resp.status === 204) {
		return {} as T;
	}

	return resp.json() as Promise<T>;
}

// --- Task Lists ---

export async function listTaskLists(token: string): Promise<TaskList[]> {
	const data = await apiCall<TaskListsResponse>(token, "GET", "/users/@me/lists");
	return data.items || [];
}

export async function createTaskList(token: string, title: string): Promise<TaskList> {
	return apiCall<TaskList>(token, "POST", "/users/@me/lists", { title });
}

export async function updateTaskList(token: string, taskListId: string, title: string): Promise<TaskList> {
	return apiCall<TaskList>(token, "PATCH", `/users/@me/lists/${taskListId}`, { title });
}

export async function deleteTaskList(token: string, taskListId: string): Promise<void> {
	await apiCall<void>(token, "DELETE", `/users/@me/lists/${taskListId}`);
}

// --- Tasks ---

export async function listTasks(
	token: string,
	taskListId: string,
	options?: { showCompleted?: boolean; showHidden?: boolean; maxResults?: number },
): Promise<Task[]> {
	const params = new URLSearchParams();
	if (options?.showCompleted !== undefined) params.set("showCompleted", String(options.showCompleted));
	if (options?.showHidden !== undefined) params.set("showHidden", String(options.showHidden));
	if (options?.maxResults !== undefined) params.set("maxResults", String(options.maxResults));

	const query = params.toString();
	const path = `/lists/${taskListId}/tasks${query ? `?${query}` : ""}`;
	const data = await apiCall<TasksResponse>(token, "GET", path);
	return data.items || [];
}

export async function createTask(
	token: string,
	taskListId: string,
	task: { title: string; notes?: string; due?: string },
): Promise<Task> {
	return apiCall<Task>(token, "POST", `/lists/${taskListId}/tasks`, task);
}

export async function updateTask(
	token: string,
	taskListId: string,
	taskId: string,
	fields: { title?: string; notes?: string; due?: string; status?: "needsAction" | "completed" },
): Promise<Task> {
	return apiCall<Task>(token, "PATCH", `/lists/${taskListId}/tasks/${taskId}`, fields);
}

export async function deleteTask(token: string, taskListId: string, taskId: string): Promise<void> {
	await apiCall<void>(token, "DELETE", `/lists/${taskListId}/tasks/${taskId}`);
}

export async function moveTask(
	token: string,
	taskListId: string,
	taskId: string,
	options?: { parent?: string; previous?: string },
): Promise<Task> {
	const params = new URLSearchParams();
	if (options?.parent) params.set("parent", options.parent);
	if (options?.previous) params.set("previous", options.previous);

	const query = params.toString();
	const path = `/lists/${taskListId}/tasks/${taskId}/move${query ? `?${query}` : ""}`;
	return apiCall<Task>(token, "POST", path);
}

export async function clearCompleted(token: string, taskListId: string): Promise<void> {
	await apiCall<void>(token, "POST", `/lists/${taskListId}/clear`);
}
