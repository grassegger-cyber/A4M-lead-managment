// Helper for methods that return a file download.

/** Builds the Response a method returns to make the browser download a file. */
export function fileResponse(
	body: Uint8Array | ArrayBuffer | string,
	filename: string,
	contentType = 'application/octet-stream'
): Response {
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	return new Response(body as BodyInit, {
		headers: {
			'content-type': contentType,
			'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
			'cache-control': 'no-store'
		}
	});
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
