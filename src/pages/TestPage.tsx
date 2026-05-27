import {AvatarPickerDialog} from "@/components/avatar-picker/AvatarPickerDialog";
import {AVATARS} from "@/components/avatar-picker/registry";
import {Button} from "@/components/ui/button";
import {useQueries} from "@tanstack/react-query";
import {useState} from "react";

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`failed to load ${url}`));
		img.src = url;
	});
}

function TestPage() {
	const urls = Array.from(new Set(AVATARS.map((a) => a.sprite.imageUrl)));
	const queries = useQueries({
		queries: urls.map((url) => ({
			queryKey: ["sprite-image", url],
			queryFn: () => loadImage(url),
			staleTime: Infinity,
			gcTime: Infinity,
		})),
	});
	const ready = queries.every((q) => q.isSuccess);
	const [open, setOpen] = useState(true);
	const [avatarId, setAvatarId] = useState<string>(AVATARS[0].id);
	const [paletteId, setPaletteId] = useState<string | null>(null);
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-8">
			{ready ? (
				<AvatarPickerDialog
					open={open}
					onOpenChange={setOpen}
					avatarId={avatarId}
					paletteId={paletteId}
					onChange={(a, p) => {
						setAvatarId(a);
						setPaletteId(p);
					}}
					trigger={<Button>Pick avatar</Button>}
				/>
			) : (
				<p className="text-sm text-muted-foreground">loading sprites…</p>
			)}
		</div>
	);
}

export default TestPage;
