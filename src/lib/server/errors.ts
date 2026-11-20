// Error type for expected failures. The message is Czech and is shown to the user as is.
export class AppError extends Error {
	code: string;
	status: number;
	constructor(code: string, message: string, status = 400) {
		super(message);
		this.name = 'AppError';
		this.code = code;
		this.status = status;
	}
}

export function isAppError(e: unknown): e is AppError {
	return e instanceof AppError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AppError');
}
