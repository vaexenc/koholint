// navigator.clipboard only exists in secure contexts (https/localhost), so a
// phone hitting the dev server over LAN http has no clipboard API at all —
// fall back to the deprecated execCommand path in that case.
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// fall through to the legacy path
		}
	}
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.append(textarea);
	textarea.select();
	try {
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		textarea.remove();
	}
}
